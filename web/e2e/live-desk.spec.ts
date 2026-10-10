import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route, type WebSocketRoute } from "@playwright/test";

// /live at the judge desk (PLAN.md 3.84). Devnet's JSON-RPC and WebSocket are intercepted and
// answered with the program's latest 20 transactions as devnet actually sent them
// (unit/fixtures/devnet-live-desk.json, its _about says how), plus the earlier test-key pair
// recorded in unit/fixtures/devnet-transactions.json. Where a test needs devnet to answer in a
// different order or later (details not read yet, a payment arriving over the socket), it says
// so; every transaction it serves is a recorded one. Expected signatures, labels and error words
// are written out here or read from docs/FACTS.json, not imported from the app.

const recorded = JSON.parse(readFileSync(path.join(__dirname, "..", "unit", "fixtures", "devnet-live-desk.json"), "utf8"));
const older = JSON.parse(readFileSync(path.join(__dirname, "..", "unit", "fixtures", "devnet-transactions.json"), "utf8"));
const facts = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "docs", "FACTS.json"), "utf8")).facts;
const pins = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "config", "pins.json"), "utf8"));
const DEVNET = /^https:\/\/api\.devnet\.solana\.com\/?$/;
const DEVNET_WS = /^wss:\/\/api\.devnet\.solana\.com\/?$/;

const SETTLED_IPHONE: string = facts.proof_pair_iphone_settled_tx.value;
const REFUSED_IPHONE: string = facts.proof_pair_iphone_refused_tx.value;
const TEST_KEY_SETTLED: string = facts.proof_pair_settled_tx.value;
const TEST_KEY_REFUSED: string = facts.proof_pair_refused_tx.value;
const SETTLED_RUN2 = "5bwtrE78DKhuQiANbY6e3ZceitYqtx85buWnVpPP14y5uLTQGLkWdntGKs3f7itYBMCW1Uqsb3ZoqWGpmGu6fF3T";
const REFUSED_RUN2 = "3uBwo59QKFcXXkGJZRPZw8X8hk6x2Yr2wr69cFDuu6c45wd38N76jBoshsEgbc2SKzAHWssUmfpSf9ACgnnUT6HK";
const SERIAL_USED = "SerialUsed (6011): This allowance serial was already redeemed.";

type SignatureEntry = { signature: string; slot: number; err: unknown; blockTime: number | null };
const LIST: SignatureEntry[] = recorded.getSignaturesForAddress.result;
const TX: Record<string, unknown> = Object.fromEntries(
  Object.entries(recorded.getTransaction as Record<string, { result: unknown }>).map(([s, a]) => [s, a.result]),
);
for (const tx of [older.redeem, older.refusedRedeem]) TX[tx.transaction.signatures[0]] = tx;

/** A signature-list entry for an older recorded transaction, from its own getTransaction answer. */
function entryFor(tx: { slot: number; blockTime: number; meta: { err: unknown }; transaction: { signatures: string[] } }): SignatureEntry {
  return { signature: tx.transaction.signatures[0], slot: tx.slot, err: tx.meta.err, blockTime: tx.blockTime };
}

/** The ISO instant of a recorded transaction's block time, as the page's <time dateTime> carries it. */
const isoOf = (signature: string) => new Date((TX[signature] as { blockTime: number }).blockTime * 1000).toISOString();
const row = (page: Page, signature: string) => page.locator(`[data-testid="tx-row"][data-signature="${signature}"]`);

interface Devnet {
  list: SignatureEntry[];
  /** While true, getTransaction answers "not found yet" (null), so rows keep waiting for details. */
  holdDetails: boolean;
  /** While true, getTransaction answers an error other than the rate limit, so the page gives up on a row. */
  failDetails: boolean;
  /** Resolves the first getSignaturesForAddress answer; until then it is held. */
  releaseHistory?: () => void;
}

async function routeDevnet(page: Page, list: SignatureEntry[], options: { holdDetails?: boolean; holdHistory?: boolean } = {}) {
  const devnet: Devnet = { list, holdDetails: options.holdDetails ?? false, failDetails: false };
  const history = options.holdHistory ? new Promise<void>((resolve) => (devnet.releaseHistory = resolve)) : Promise.resolve();
  await page.route(DEVNET, async (route: Route) => {
    const body = route.request().postDataJSON();
    const messages = Array.isArray(body) ? body : [body];
    if (messages.some((m) => m.method === "getSignaturesForAddress")) await history;
    const answer = (msg: { id: number; method: string; params: unknown[] }) => {
      if (msg.method === "getSignaturesForAddress") return { jsonrpc: "2.0", id: msg.id, result: devnet.list };
      if (msg.method === "getTransaction" && devnet.failDetails) {
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32005, message: "node is behind (test fixture)" } };
      }
      if (msg.method === "getTransaction") {
        return { jsonrpc: "2.0", id: msg.id, result: devnet.holdDetails ? null : (TX[msg.params[0] as string] ?? null) };
      }
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not in the test fixture" } };
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? messages.map(answer) : answer(body)) });
  });
  return devnet;
}

/** Acknowledges logsSubscribe; `notify` sends a recorded transaction's logs as a new arrival. */
async function routeSocket(page: Page) {
  const socket: { ws?: WebSocketRoute; notify: (signature: string) => void } = {
    notify: (signature) => {
      const tx = TX[signature] as { slot: number; meta: { err: unknown; logMessages: string[] } };
      socket.ws!.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "logsNotification",
          params: { subscription: 42, result: { context: { slot: tx.slot }, value: { signature, err: tx.meta.err, logs: tx.meta.logMessages } } },
        }),
      );
    },
  };
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    socket.ws = ws;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "logsSubscribe") {
        expect(msg.params[0]).toEqual({ mentions: [pins.programId] });
        ws.send(JSON.stringify({ jsonrpc: "2.0", result: 42, id: msg.id }));
      }
    });
  });
  return socket;
}

test("/live: refused rows are named from the error code before their details load, and no row shows raw error JSON", async ({ page }) => {
  // Devnet answers the list but has no details yet ("not found yet"), as under a rate limit.
  const devnet = await routeDevnet(page, LIST, { holdDetails: true });
  await routeSocket(page);
  await page.goto("/live");
  const failed = LIST.filter((s) => s.err !== null).map((s) => s.signature);
  expect(failed).toEqual(expect.arrayContaining([REFUSED_IPHONE, REFUSED_RUN2]));
  for (const signature of failed) {
    const r = row(page, signature);
    await expect(r).toHaveAttribute("data-details", "reading");
    await expect(r.getByTestId("tx-error")).toHaveText(SERIAL_USED);
    await expect(r.getByTestId("tx-status")).toHaveText("Failed: SerialUsed");
  }
  await expect(page.getByTestId("tx-row")).toHaveCount(20);
  await expect(page.getByTestId("tx-list")).not.toContainText("InstructionError");
  await expect(page.getByTestId("tx-list")).not.toContainText("{");
  // After the page gives up on the details, the rows still say why they failed, in words.
  devnet.failDetails = true;
  await expect(row(page, REFUSED_IPHONE)).toHaveAttribute("data-details", "unread", { timeout: 20_000 });
  await expect(row(page, REFUSED_IPHONE).getByTestId("tx-error")).toHaveText(SERIAL_USED);
  await expect(page.getByTestId("tx-list")).not.toContainText("InstructionError");
});

test("/live: with details, the iPhone pair is labelled from FACTS and still no row shows raw error JSON", async ({ page }) => {
  // Reading all 20 rows' details takes three batches at 8 per 11 s.
  test.setTimeout(60_000);
  await routeDevnet(page, LIST);
  await routeSocket(page);
  await page.goto("/live");
  const settled = row(page, SETTLED_IPHONE);
  // Details arrive 8 per 11 s (lib/program-feed.ts pacing), newest first; this row is in the second batch.
  await expect(settled).toHaveAttribute("data-details", "read", { timeout: 20_000 });
  await expect(settled.getByTestId("tx-label")).toHaveText("iPhone payment");
  await expect(settled.getByTestId("tx-label-detail")).toHaveText("Signed on an iPhone (Secure Enclave key), paid offline by camera QR, Sat Oct 10 4:23 PM ET");
  const refused = row(page, REFUSED_IPHONE);
  await expect(refused).toHaveAttribute("data-details", "read", { timeout: 20_000 });
  await expect(refused.getByTestId("tx-label")).toHaveText("iPhone cheat");
  await expect(refused.getByTestId("tx-label-detail")).toHaveText(
    "Same allowance and serial signed again on that iPhone, refused by Solana: SerialUsed (6011), Sat Oct 10 4:31 PM ET",
  );
  await expect(refused.getByTestId("tx-error")).toHaveText(SERIAL_USED);
  // The 5:05 PM pair has no FACTS entry, so it carries no label.
  await expect(row(page, REFUSED_RUN2).getByTestId("tx-label")).toHaveCount(0);
  await expect(page.getByTestId("tx-label")).toHaveCount(2);
  await expect.poll(() => page.locator('[data-testid="tx-row"][data-details="reading"]').count(), { timeout: 30_000 }).toBe(0);
  await expect(page.getByTestId("tx-list")).not.toContainText("InstructionError");
});

test("/live: the test-key pair is labelled Test key from FACTS", async ({ page }) => {
  // The list as devnet sent it, with the earlier recorded test-key pair after it (older slots).
  await routeDevnet(page, [...LIST, entryFor(older.redeem), entryFor(older.refusedRedeem)]);
  await routeSocket(page);
  await page.goto("/live");
  for (const signature of [TEST_KEY_SETTLED, TEST_KEY_REFUSED]) {
    await expect(row(page, signature).getByTestId("tx-label")).toHaveText("Test key");
    await expect(row(page, signature).getByTestId("tx-label-detail")).toHaveText("Signed outside the iPhone app with a test key, Sat Oct 10 2:01 AM ET.");
  }
});
