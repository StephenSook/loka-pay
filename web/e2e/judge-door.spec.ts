import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

// The judge door pages (PLAN.md 3.2, 3.24, 3.60, 3.72). /judge, /proof and /trust read
// devnet and GitHub on the server, which Playwright cannot intercept, so those checks
// accept either the real devnet facts or the page's honest failure notice, and assert
// the shape of whichever one is on screen. /live reads devnet from the browser, so its
// parser checks run against intercepted RPC and WebSocket traffic.
//
// Expected values are read from config/pins.json and the recorded fixtures here, not
// imported from the app, so a wrong page value fails instead of passing by construction.

const repoRoot = path.resolve(__dirname, "..", "..");
const pins = JSON.parse(readFileSync(path.join(repoRoot, "config", "pins.json"), "utf8"));
const recorded = JSON.parse(readFileSync(path.join(__dirname, "..", "unit", "fixtures", "devnet-transactions.json"), "utf8"));
const INIT_TX = "2y4go46y25K6yMnSc4eVZCtbs3nKQzubb6Qr2Byp6piXGuCMWniaiL2aVBsrfMkAxUfJ9odVNcKKpqG3g4EraT4R";
// The first real settled redeem_note on devnet (the README's "settled payment" link).
const FIRST_REDEEM_TX = "5tEKu2mtrdzu9hVaXCmkGyq9Y6mTobNVBmVx5ji59hku2bf28E3okmJatw7WbPRqfHHpLf9wyC1SbjwU3PWD5rAa";
const DEVNET = /^https:\/\/api\.devnet\.solana\.com\/?$/;
const DEVNET_WS = /^wss:\/\/api\.devnet\.solana\.com\/?$/;

async function open(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response, `no response for ${url}`).not.toBeNull();
  expect(response!.status()).toBe(200);
  expect((await response!.allHeaders())["set-cookie"]).toBeUndefined();
}

function watchForeign(page: Page, baseURL: string) {
  const own = new URL(baseURL).origin;
  const foreign: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.origin !== own) foreign.push(req.url());
  });
  return foreign;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const HEADINGS: Record<string, string> = {
  "/judge": "Judge door",
  "/trust": "Trust",
  "/proof": "Proof",
  "/live": "Live from devnet",
};

for (const [pagePath, heading] of Object.entries(HEADINGS)) {
  for (const width of [390, 1440]) {
    test(`${pagePath}: loads with no login, no cookie and no sideways scroll at ${width} px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, pagePath);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByTestId("sandbox-chip").first()).toBeVisible();
      // The header marks the current page.
      const navName = heading.split(" ")[0];
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: navName, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await noSidewaysScroll(page);
      expect(await context.cookies()).toEqual([]);
    });
  }
}

test("header and landing page link to every judge door page", async ({ page }) => {
  await open(page, "/");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [name, href] of [
    ["Judge", "/judge"],
    ["Live", "/live"],
    ["Verify", "/verify"],
    ["Proof", "/proof"],
    ["Trust", "/trust"],
  ]) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: /Judge door/ })).toHaveAttribute("href", "/judge");
  for (const href of ["/live", "/verify", "/proof", "/trust"]) {
    await expect(main.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
});

test("/judge: seven numbered stops, the program facts or an honest failure, real CI badges", async ({ page, baseURL }) => {
  const foreign = watchForeign(page, baseURL!);
  await open(page, "/judge");
  const steps = page.getByRole("list", { name: "Itinerary" }).getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
  await expect(steps).toHaveCount(7);
  for (const [n, title] of [
    [1, "Check a receipt in your browser"],
    [2, "The program on devnet"],
    [3, "Watch the chain"],
    [4, "Proof"],
    [5, "Trust"],
    [6, "The iPhone app"],
    [7, "The code and its checks"],
  ] as const) {
    await expect(page.getByTestId(`step-${n}`).getByRole("heading", { level: 2 })).toHaveText(`Step ${n}: ${title}`);
  }
  for (const href of ["/verify", "/live", "/proof", "/trust"]) {
    await expect(page.getByRole("main").locator(`a[href="${href}"]`).first()).toBeVisible();
  }

  await expect(page.getByTestId("program-id")).toHaveText(pins.programId);
  await expect(page.getByTestId("program-explorer-link")).toHaveAttribute(
    "href",
    `https://explorer.solana.com/address/${pins.programId}?cluster=devnet`,
  );
  const facts = page.getByTestId("program-facts");
  const failure = page.getByTestId("read-failure");
  await expect(facts.or(failure)).toBeVisible();
  if (await facts.isVisible()) {
    await expect(page.getByTestId("fact-executable")).toHaveText("Yes, executable");
    await expect(page.getByTestId("fact-authority")).toContainText(pins.upgradeAuthority);
    await expect(page.getByTestId("fact-init")).toContainText("initialize_vault");
    await expect(page.getByTestId("fact-init")).toContainText("Succeeded");
    await expect(page.getByTestId("init-explorer-link")).toHaveAttribute("href", `https://explorer.solana.com/tx/${INIT_TX}?cluster=devnet`);
    await expect(page.getByTestId("count-VaultConfig")).toHaveText("Config: 1");
    await expect(page.getByTestId("program-read-stamp")).toContainText(/Read from Solana devnet at slots? \d+/);
  } else {
    test.info().annotations.push({ type: "devnet", description: "devnet read failed; checked the failure notice instead" });
    await expect(failure).toContainText("Could not read the program from devnet.");
    await expect(failure).toContainText("Tried at");
  }

  await expect(page.getByTestId("testflight-status")).toHaveText(
    "TestFlight build 1 submitted to Apple beta review Sat Oct 10 12:05 AM ET; the public link appears here once Apple approves.",
  );
  await expect(page.getByTestId("repo-link")).toHaveAttribute("href", "https://github.com/StephenSook/loka-pay");
  // Every workflow in .github/workflows has its badge, so a red one cannot be left out.
  const workflows = readdirSync(path.join(repoRoot, ".github", "workflows"))
    .filter((f) => f.endsWith(".yml"))
    .map((f) => f.replace(/\.yml$/, ""));
  expect(workflows.length).toBeGreaterThanOrEqual(6);
  await expect(page.getByRole("list", { name: "GitHub Actions workflows" }).getByRole("listitem")).toHaveCount(workflows.length);
  for (const file of workflows) {
    await expect(page.getByTestId(`badge-${file}`)).toHaveAttribute(
      "src",
      `https://github.com/StephenSook/loka-pay/actions/workflows/${file}.yml/badge.svg`,
    );
  }
  await expect(page.getByTestId("server-workflow-note")).toContainText("its badge stays red until that code is merged");
  await page.waitForLoadState("networkidle");
  // The only requests to another origin are GitHub's badge images.
  for (const url of foreign) expect(url).toMatch(/^https:\/\/github\.com\/StephenSook\/loka-pay\/actions\/workflows\/[a-z]+\.yml\/badge\.svg$/);
});

test("/trust: pilot status, custody, the checks and the limits; no request leaves the site", async ({ page, baseURL }) => {
  const foreign = watchForeign(page, baseURL!);
  await open(page, "/trust");
  await expect(page.getByTestId("pilot-status")).toHaveText("Devnet pilot, unaudited, not frozen on purpose.");
  for (const name of ["Who holds what", "What the program checks before it moves money", "What the protocol does not promise"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  // The spec's words (PAYMENT-V1 section 1): the server cannot forge a payer's NOTE, and
  // its key alone is trusted by phones for confirmations and certificates.
  await expect(page.getByRole("main")).toContainText("It cannot forge a payer's note");
  await expect(page.getByRole("main")).not.toContainText("cannot forge a payment");
  await expect(page.getByTestId("server-key-risk")).toHaveText(
    "Phones show Paid on its signed confirmation, and merchants accept its signed certificates offline, so whoever holds the server's Ed25519 key can sign a false confirmation or certificate that phones trust. The chain still decides who actually got paid.",
  );
  const server = page.getByTestId("server-status");
  if (pins.serverEd25519PublicKey === null) {
    await expect(server).toHaveText("The settlement server is not live yet: its key is not published in config/pins.json.");
  } else {
    await expect(server).toContainText(pins.serverEd25519PublicKey);
  }
  const authority = page.getByTestId("upgrade-authority");
  const failure = page.getByTestId("read-failure");
  await expect(authority.or(failure)).toBeVisible();
  if (await authority.isVisible()) {
    await expect(authority).toHaveText(pins.upgradeAuthority);
    await expect(page.getByTestId("custody-authority")).toContainText("A 2-of-3 multisig is planned (task 3.46), not done.");
  }
  await expect(page.getByRole("main")).toContainText("Double spending is bounded, not prevented.");
  await page.waitForLoadState("networkidle");
  expect(foreign).toEqual([]);
});

test("/proof: Live claims link their evidence, Building claims link nothing; reserves and commits or honest failures", async ({
  page,
  baseURL,
  request,
}) => {
  const foreign = watchForeign(page, baseURL!);
  await open(page, "/proof");
  const claims = page.locator('[data-testid^="claim-"][data-status]');
  expect(await claims.count()).toBeGreaterThanOrEqual(8);
  for (const claim of await claims.all()) {
    const status = await claim.getAttribute("data-status");
    const evidence = claim.getByTestId("claim-evidence");
    if (status === "live") {
      await expect(evidence).toHaveCount(1);
      await expect(claim.getByTestId("claim-status")).toHaveText("Live");
    } else {
      await expect(evidence).toHaveCount(0);
      await expect(claim.getByTestId("claim-evidence-more")).toHaveCount(0);
      await expect(claim.getByTestId("claim-status")).toHaveText(status === "building" ? "Building" : "Not checked");
    }
  }
  // A redeemed note is evidenced by the first settled redeem itself, which cannot scroll off
  // /live's newest rows; /live is the second link.
  const redeemed = page.getByTestId("claim-redeemed");
  if ((await redeemed.getAttribute("data-status")) === "live") {
    await expect(redeemed.getByTestId("claim-evidence")).toHaveAttribute("href", `https://explorer.solana.com/tx/${FIRST_REDEEM_TX}?cluster=devnet`);
    await expect(redeemed.getByTestId("claim-evidence-more")).toHaveAttribute("href", "/live");
  } else {
    test.info().annotations.push({ type: "devnet", description: `redeemed claim: ${await redeemed.innerText()}` });
  }
  await expect(page.getByTestId("claim-server")).toHaveAttribute("data-status", "building");
  await expect(page.getByTestId("claim-testflight")).toHaveAttribute("data-status", "building");
  // The same dated status as /judge step 6.
  await expect(page.getByTestId("claim-testflight")).toContainText(
    "TestFlight build 1 submitted to Apple beta review Sat Oct 10 12:05 AM ET; the public link appears here once Apple approves. Status as of 2026-10-10.",
  );

  // Proof of reserves: liabilities plus the difference equal the assets, as printed.
  const reserves = page.getByTestId("reserves");
  const reservesFailure = page.locator("#reserves").getByTestId("read-failure");
  await expect(reserves.or(reservesFailure)).toBeVisible();
  if (await reserves.isVisible()) {
    const units = async (id: string) => Number((await page.getByTestId(id).innerText()).replace(/[^0-9.-]/g, ""));
    const assets = await units("reserves-assets");
    const liabilities = await units("reserves-liabilities");
    const difference = await units("reserves-difference");
    const parts = (await units("reserves-allowances")) + (await units("reserves-bonds")) + (await units("reserves-merchants"));
    expect(Math.round((liabilities - parts) * 1e6)).toBe(0);
    expect(Math.round((assets - liabilities - difference) * 1e6)).toBe(0);
    await expect(page.getByTestId("reserves-verdict")).toHaveText(difference >= 0 ? "Covered" : "Short");
    await expect(page.getByTestId("reserves-read-stamp")).toContainText(/at slot \d+, every balance in one call/);
  }
  await expect(page.getByTestId("reserves-not-shown")).toContainText("Bounty and operator credits");

  // Built this weekend: the compare link always; the numbers only from a successful read.
  await expect(page.getByTestId("built-label")).toContainText("since hacking started, Fri Oct 9 8:08 PM ET");
  await expect(page.getByTestId("compare-link")).toHaveAttribute(
    "href",
    "https://github.com/StephenSook/loka-pay/compare/pre-hacklanta-kit...main",
  );
  const commits = page.getByTestId("built-commits");
  const unavailable = page.getByTestId("built-unavailable");
  await expect(commits.or(unavailable)).toBeVisible();
  if (await commits.isVisible()) {
    const shown = Number((await commits.innerText()).replace(/,/g, ""));
    expect(shown).toBeGreaterThan(0);
    // The same API, read by the test now. The page's read is cached for up to 5 minutes,
    // so a commit may land in between; the page can be behind, never ahead.
    const api = await request.get("https://api.github.com/repos/StephenSook/loka-pay/compare/pre-hacklanta-kit...main", {
      headers: { accept: "application/vnd.github+json" },
    });
    if (api.ok()) {
      const total = (await api.json()).total_commits as number;
      expect(shown).toBeLessThanOrEqual(total);
    } else {
      test.info().annotations.push({ type: "github", description: `test's own compare read answered ${api.status()}` });
    }
  } else {
    await expect(unavailable).toContainText("Could not read the commit count from GitHub.");
  }
  await page.waitForLoadState("networkidle");
  expect(foreign).toEqual([]);
});

// ---------- /live against intercepted devnet traffic ----------

/** A recorded getSignaturesForAddress answer for the two real transactions, newest first. */
function recordedSignatures() {
  return [recorded.initializeVault, recorded.deploy].map((tx) => ({
    signature: tx.transaction.signatures[0],
    slot: tx.slot,
    err: null,
    memo: null,
    blockTime: tx.blockTime,
    confirmationStatus: "finalized",
  }));
}

// TEST FIXTURE: a redeem_note in the shape the runtime and Anchor log it, with a
// NoteRedeemed event (amount 2.50) built field by field from state.rs. Not a real transaction.
const LIVE_SIG = "4fixtureRedeemSignatureXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
function redeemLogs(): string[] {
  const le64 = (n: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const event = Buffer.concat([
    Buffer.from([57, 237, 250, 78, 46, 209, 221, 34]),
    Buffer.alloc(32, 0x44),
    le64(17),
    Buffer.from([3]),
    Buffer.alloc(32, 0x55),
    le64(2_500_000),
  ]).toString("base64");
  return [
    `Program ${pins.programId} invoke [1]`,
    "Program log: Instruction: RedeemNote",
    `Program data: ${event}`,
    `Program ${pins.programId} success`,
  ];
}
function redeemTransaction() {
  return {
    slot: 600_000_000,
    blockTime: 1_791_700_000,
    meta: { err: null, logMessages: redeemLogs() },
    transaction: { signatures: [LIVE_SIG], message: { accountKeys: [pins.programId], instructions: [] } },
  };
}

function transactionFor(signature: string) {
  if (signature === LIVE_SIG) return redeemTransaction();
  return [recorded.initializeVault, recorded.deploy].find((t) => t.transaction.signatures[0] === signature) ?? null;
}

/** Answers devnet JSON-RPC from the recorded fixtures; counts calls by method. */
async function routeDevnet(
  page: Page,
  options: { failHistory?: boolean; failTransactions?: () => boolean; malformedSignature?: string } = {},
) {
  const calls: Record<string, number> = {};
  await page.route(DEVNET, async (route: Route) => {
    const body = route.request().postDataJSON();
    const answer = (msg: { id: number; method: string; params: unknown[] }) => {
      calls[msg.method] = (calls[msg.method] ?? 0) + 1;
      if (msg.method === "getSignaturesForAddress") return { jsonrpc: "2.0", id: msg.id, result: recordedSignatures() };
      if (msg.method === "getTransaction" && options.failTransactions?.()) {
        // An error other than the rate limit: the page gives up on the row ("Details not read").
        return { jsonrpc: "2.0", id: msg.id, error: { code: -32005, message: "node is behind (test fixture)" } };
      }
      if (msg.method === "getTransaction" && msg.params[0] === options.malformedSignature) {
        // TEST FIXTURE: the right outer shape, but a log line that is not a string.
        const tx = transactionFor(msg.params[0] as string);
        return { jsonrpc: "2.0", id: msg.id, result: { ...tx, meta: { err: null, logMessages: [null] } } };
      }
      if (msg.method === "getTransaction") return { jsonrpc: "2.0", id: msg.id, result: transactionFor(msg.params[0] as string) };
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not in the test fixture" } };
    };
    if (options.failHistory) {
      await route.fulfill({ status: 503, body: "unavailable" });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
  return calls;
}

test("/live: recorded history, then a new transaction over the WebSocket within seconds", async ({ page }) => {
  const calls = await routeDevnet(page);
  const hooks: { notify?: () => void } = {};
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "logsSubscribe") {
        expect(msg.params[0]).toEqual({ mentions: [pins.programId] });
        ws.send(JSON.stringify({ jsonrpc: "2.0", result: 42, id: msg.id }));
        hooks.notify = () =>
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "logsNotification",
              params: { subscription: 42, result: { context: { slot: 600_000_000 }, value: { signature: LIVE_SIG, err: null, logs: redeemLogs() } } },
            }),
          );
      }
    });
  });

  await open(page, "/live");
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "live");
  await expect(page.getByTestId("history-state")).toHaveAttribute("data-state", "ok");
  const initRow = page.locator(`[data-testid="tx-row"][data-signature="${INIT_TX}"]`);
  await expect(initRow.getByTestId("tx-action")).toHaveText("initialize_vault");
  await expect(initRow.getByTestId("tx-status")).toHaveText("Succeeded");
  await expect(initRow.getByTestId("tx-explorer")).toHaveAttribute("href", `https://explorer.solana.com/tx/${INIT_TX}?cluster=devnet`);
  await expect(page.locator(`[data-testid="tx-row"][data-signature="${recorded.deploy.transaction.signatures[0]}"]`).getByTestId("tx-action")).toHaveText(
    "program deployed",
  );
  await expect(page.getByTestId("last-event")).toContainText("none since this page opened");

  expect(hooks.notify).toBeDefined();
  hooks.notify!();
  const liveRow = page.locator(`[data-testid="tx-row"][data-signature="${LIVE_SIG}"]`);
  await expect(liveRow.getByTestId("tx-action")).toHaveText("redeem_note", { timeout: 5000 });
  await expect(liveRow.getByTestId("tx-new")).toHaveText("New");
  await expect(liveRow.getByTestId("tx-amounts")).toHaveText("Note redeemed: 2.50 sandbox USDC");
  await expect(page.getByTestId("tx-row").first()).toHaveAttribute("data-signature", LIVE_SIG);
  await expect(page.getByTestId("last-event")).toContainText(/ET$/);
  // The block time arrives from getTransaction after the notification.
  await expect(liveRow).toHaveAttribute("data-details", "read");
  expect(calls.getSignaturesForAddress).toBe(1);
});

test("/live: a closed socket shows Reconnecting, reconnects, and reads the history again", async ({ page }) => {
  const calls = await routeDevnet(page);
  let connections = 0;
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    connections += 1;
    const n = connections;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method !== "logsSubscribe") return;
      ws.send(JSON.stringify({ jsonrpc: "2.0", result: n, id: msg.id }));
      // The first connection drops right after subscribing.
      if (n === 1) setTimeout(() => ws.close(), 300);
    });
  });
  await open(page, "/live");
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "reconnecting");
  await expect(page.getByTestId("connection")).toContainText("Attempt 1 of 8");
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "live", { timeout: 10_000 });
  expect(connections).toBe(2);
  await expect.poll(() => calls.getSignaturesForAddress).toBe(2);
});

test("/live: rows whose details could not be read are read again after a reconnect", async ({ page }) => {
  const devnet = { failing: true };
  const calls = await routeDevnet(page, { failTransactions: () => devnet.failing });
  let connections = 0;
  const sockets: { first?: { close: () => void } } = {};
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    connections += 1;
    const n = connections;
    if (n === 1) sockets.first = ws;
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "logsSubscribe") ws.send(JSON.stringify({ jsonrpc: "2.0", result: n, id: msg.id }));
    });
  });
  await open(page, "/live");
  const initRow = page.locator(`[data-testid="tx-row"][data-signature="${INIT_TX}"]`);
  await expect(initRow).toHaveAttribute("data-details", "unread");
  await expect(initRow.getByTestId("tx-action")).toHaveText("Details not read");
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "live");

  // Devnet recovers, the socket drops, the page reconnects and reads the history again.
  devnet.failing = false;
  sockets.first!.close();
  await expect.poll(() => calls.getSignaturesForAddress, { timeout: 10_000 }).toBe(2);
  await expect(initRow).toHaveAttribute("data-details", "read");
  await expect(initRow.getByTestId("tx-action")).toHaveText("initialize_vault");
  await expect(
    page.locator(`[data-testid="tx-row"][data-signature="${recorded.deploy.transaction.signatures[0]}"]`).getByTestId("tx-action"),
  ).toHaveText("program deployed");
});

test("/live: a malformed transaction answer marks only its own row, which still links the explorer", async ({ page }) => {
  await routeDevnet(page, { malformedSignature: INIT_TX });
  await page.routeWebSocket(DEVNET_WS, () => {});
  await open(page, "/live");
  const initRow = page.locator(`[data-testid="tx-row"][data-signature="${INIT_TX}"]`);
  await expect(initRow).toHaveAttribute("data-details", "unavailable");
  await expect(initRow.getByTestId("tx-action")).toHaveText("Details unavailable: devnet's answer could not be read");
  await expect(initRow.getByTestId("tx-explorer")).toHaveAttribute("href", `https://explorer.solana.com/tx/${INIT_TX}?cluster=devnet`);
  // The other row in the same batch is read.
  const deployRow = page.locator(`[data-testid="tx-row"][data-signature="${recorded.deploy.transaction.signatures[0]}"]`);
  await expect(deployRow).toHaveAttribute("data-details", "read");
  await expect(deployRow.getByTestId("tx-action")).toHaveText("program deployed");
});

test("/live: a socket that goes silent without closing stops saying Live, and says Live again when traffic resumes", async ({ page }) => {
  await routeDevnet(page);
  const sockets: { send?: (text: string) => void } = {};
  const subscribed: string[] = [];
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    sockets.send = (text) => ws.send(text);
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      subscribed.push(msg.method);
      // Both subscriptions are confirmed, then the socket sends nothing at all.
      ws.send(JSON.stringify({ jsonrpc: "2.0", result: msg.id + 40, id: msg.id }));
    });
  });
  await open(page, "/live");
  const connection = page.getByTestId("connection");
  await expect(connection).toHaveAttribute("data-state", "live");
  await expect.poll(() => subscribed).toEqual(["logsSubscribe", "slotSubscribe"]);
  // The page's window is 10 s of silence.
  await expect(connection).toHaveAttribute("data-state", "stalled", { timeout: 15_000 });
  await expect(connection).toContainText(/No update for 1\d s/);
  await expect(connection).toContainText("Nothing has arrived on the WebSocket for");
  sockets.send!(JSON.stringify({ jsonrpc: "2.0", method: "slotNotification", params: { subscription: 42, result: { slot: 600_000_001, parent: 600_000_000, root: 599_999_990 } } }));
  await expect(connection).toHaveAttribute("data-state", "live");
  await expect(connection).toContainText("Live");
});

test("/live: a failed history read is said plainly, never filled in", async ({ page }) => {
  await routeDevnet(page, { failHistory: true });
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "logsSubscribe") ws.send(JSON.stringify({ jsonrpc: "2.0", result: 1, id: msg.id }));
    });
  });
  await open(page, "/live");
  await expect(page.getByTestId("history-state")).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("history-state")).toContainText("answered HTTP 503");
  await expect(page.getByTestId("tx-row")).toHaveCount(0);
  await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "live");
});

test("/live?kiosk=1 uses large type", async ({ page }) => {
  await routeDevnet(page);
  await page.routeWebSocket(DEVNET_WS, () => {});
  await open(page, "/live");
  const normal = await page.getByRole("heading", { level: 1 }).evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
  await open(page, "/live?kiosk=1");
  const kiosk = await page.getByRole("heading", { level: 1 }).evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
  expect(kiosk).toBeGreaterThan(normal);
});

test("/live against real devnet: the subscription opens or the page says why; the initialize transaction is listed", async ({ page }) => {
  await open(page, "/live");
  const history = page.getByTestId("history-state");
  await expect(history).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
  if ((await history.getAttribute("data-state")) === "ok") {
    // The program has had more than 20 transactions once traffic grows; until then the
    // initialize transaction is among the latest 20.
    const rows = await page.getByTestId("tx-row").count();
    expect(rows).toBeGreaterThan(0);
    if (rows < 20) await expect(page.locator(`[data-testid="tx-row"][data-signature="${INIT_TX}"]`)).toHaveCount(1);
  } else {
    test.info().annotations.push({ type: "devnet", description: await history.innerText() });
    await expect(history).toContainText("Could not read the latest transactions");
  }
  const connection = page.getByTestId("connection");
  await expect(connection).not.toHaveAttribute("data-state", "connecting", { timeout: 20_000 });
  const state = await connection.getAttribute("data-state");
  // "stalled": subscribed, but nothing has arrived on the socket for 10 s.
  expect(["live", "stalled", "reconnecting", "failed"]).toContain(state);
  if (state !== "live") test.info().annotations.push({ type: "devnet", description: await connection.innerText() });
});
