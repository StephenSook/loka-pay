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

test("/live: with details, both iPhone runs are labelled from FACTS and still no row shows raw error JSON", async ({ page }) => {
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
  // The second iPhone run (5:05 and 5:09 PM) has its own FACTS entries.
  await expect(row(page, SETTLED_RUN2).getByTestId("tx-label")).toHaveText("iPhone payment");
  await expect(row(page, SETTLED_RUN2).getByTestId("tx-label-detail")).toHaveText(facts.proof_pair_iphone_run2_settled_tx.caveat);
  await expect(row(page, REFUSED_RUN2).getByTestId("tx-label")).toHaveText("iPhone cheat");
  await expect(row(page, REFUSED_RUN2).getByTestId("tx-label-detail")).toHaveText(facts.proof_pair_iphone_run2_refused_tx.caveat);
  // Every other recorded row (opens, registrations, the 3:44 PM refusal) has no FACTS entry and no label.
  await expect(page.getByTestId("tx-label")).toHaveCount(4);
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

test("/live?kiosk=1: no site header, footer or intro; a large Last payment line shows the newest payment, then each new one", async ({ page }) => {
  // Devnet's list as it stood before the 5:05 PM payment: the recorded entries older than it.
  const cut = LIST.findIndex((s) => s.signature === SETTLED_RUN2);
  await routeDevnet(page, LIST.slice(cut + 1));
  const socket = await routeSocket(page);
  await page.goto("/live?kiosk=1");

  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Live from devnet: the judge desk screen");
  await expect(page.getByText("Want your phone to ring")).toHaveCount(0);
  await expect(page.getByTestId("sandbox-chip")).toBeVisible();

  const last = page.getByTestId("last-payment");
  await expect(last).toHaveAttribute("data-state", "refused");
  await expect(last).toHaveAttribute("data-signature", REFUSED_IPHONE);
  await expect(last.getByTestId("last-payment-headline")).toHaveText("Refused: SerialUsed (6011)");
  await expect(last.getByTestId("last-payment-reason")).toHaveText("This allowance serial was already redeemed. No money moved.");
  await expect(last.getByTestId("last-payment-label")).toHaveText("iPhone cheat");
  // The block time devnet recorded (WebKit and Chromium word the date differently; the instant is the check).
  await expect(last.getByTestId("last-payment-when").locator("time")).toHaveAttribute("datetime", isoOf(REFUSED_IPHONE));
  await expect(last.getByTestId("last-payment-when")).toContainText("4:31:16 PM ET");
  await expect(last.getByTestId("last-payment-when")).toContainText("3XtQtnHR…");
  await expect(last.getByTestId("last-payment-new")).toHaveCount(0);
  const box = await last.boundingBox();
  expect(box!.y).toBeLessThan(200);
  const headlineSize = await last.getByTestId("last-payment-headline").evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
  expect(headlineSize).toBeGreaterThanOrEqual(48);

  // The recorded 5:05 PM payment arrives over the socket.
  socket.notify(SETTLED_RUN2);
  await expect(last).toHaveAttribute("data-signature", SETTLED_RUN2);
  await expect(last).toHaveAttribute("data-state", "paid");
  await expect(last.getByTestId("last-payment-headline")).toHaveText("Paid 0.25 sandbox USDC");
  await expect(last.getByTestId("last-payment-new")).toHaveText("New");
  await expect(last.getByTestId("last-payment-label")).toHaveText("iPhone payment");
  // Its block time comes with its details, queued behind the first batch under the same pacing.
  await expect(last.getByTestId("last-payment-when").locator("time")).toHaveAttribute("datetime", isoOf(SETTLED_RUN2), { timeout: 20_000 });
  await expect(last.getByTestId("last-payment-when")).toContainText("5:05:58 PM ET");

  // Then its cheat.
  socket.notify(REFUSED_RUN2);
  await expect(last).toHaveAttribute("data-signature", REFUSED_RUN2);
  await expect(last.getByTestId("last-payment-headline")).toHaveText("Refused: SerialUsed (6011)");
  await expect(last.getByTestId("last-payment-label")).toHaveText("iPhone cheat");
});

test("/live first paint, before devnet answers: the list and the kiosk say what they are waiting for", async ({ page }) => {
  const devnet = await routeDevnet(page, LIST, { holdHistory: true });
  await routeSocket(page);
  await page.goto("/live?kiosk=1");
  await expect(page.getByTestId("last-payment")).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("last-payment-headline")).toHaveText("Waiting for devnet: reading the program's latest 20 transactions to find the last payment.");
  await expect(page.getByTestId("tx-empty")).toHaveAttribute("data-state", "loading");
  await expect(page.getByTestId("tx-empty")).toContainText("Waiting for devnet: this browser is reading the program's latest 20 transactions from api.devnet.solana.com.");
  devnet.releaseHistory!();
  await expect(page.getByTestId("tx-row")).toHaveCount(20);
  await expect(page.getByTestId("tx-empty")).toHaveCount(0);
  await expect(page.getByTestId("last-payment")).toHaveAttribute("data-state", "refused");
});

test("/live with no transactions at all says so, and that a new one appears as it lands", async ({ page }) => {
  await routeDevnet(page, []);
  await routeSocket(page);
  await page.goto("/live?kiosk=1");
  await expect(page.getByTestId("tx-empty")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("tx-empty")).toHaveText("No transactions for this program yet. A new one appears here as it lands.");
  await expect(page.getByTestId("last-payment")).toHaveAttribute("data-state", "none");
  await expect(page.getByTestId("last-payment-headline")).toHaveText("No payment among the latest 20 transactions. The next one appears here as soon as it lands.");
});

for (const url of ["/live", "/live?kiosk=1"]) {
  test(`${url} at 390 px: no horizontal scroll with the recorded rows`, async ({ page }) => {
    await routeDevnet(page, LIST);
    await routeSocket(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await expect(row(page, REFUSED_IPHONE)).toHaveAttribute("data-details", "read");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
}
