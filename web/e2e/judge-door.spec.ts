import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_GITHUB_TOKEN, EXPECTED, HEALTH, UPSTREAM } from "./fixtures/upstream";
import { FAILING_URL } from "./fixtures/ports";

// The judge door pages (PLAN.md 3.2, 3.24, 3.60, 3.72). /judge, /proof and /trust read
// devnet and GitHub on the server. The e2e server they are tested on reads a local stand-in
// for both (e2e/fixtures/upstream.ts, wired up in playwright.config.ts), so the success path
// is asserted every run with known values. A second e2e server (FAILING_URL) reads a port
// where nothing listens, so the failure path is asserted every run too. /live reads devnet
// from the browser, so its parser checks run against intercepted RPC and WebSocket traffic.
//
// Expected values are read from config/pins.json, the recorded fixtures and the stand-in's
// EXPECTED literals, not imported from the app, so a wrong page value fails instead of
// passing by construction.

const repoRoot = path.resolve(__dirname, "..", "..");
const pins = JSON.parse(readFileSync(path.join(repoRoot, "config", "pins.json"), "utf8"));
const recorded = JSON.parse(readFileSync(path.join(__dirname, "..", "unit", "fixtures", "devnet-transactions.json"), "utf8"));
const INIT_TX = "2y4go46y25K6yMnSc4eVZCtbs3nKQzubb6Qr2Byp6piXGuCMWniaiL2aVBsrfMkAxUfJ9odVNcKKpqG3g4EraT4R";
// The first payment signed on an iPhone, settled on devnet Sat Oct 10 4:23 PM ET (the README's
// "settled iPhone payment" link). /proof links it as the evidence of a redeemed note.
const IPHONE_SETTLED_TX = "2SpG1YURVivMHY3VNWwRsDfo7SZBjWZHXZHeqAovEh6RTNE4XVVNrH5BzU84yJk6nXyqprdHAxt22QSuktskez17";
// The earlier redeem signed outside the iPhone app, Sat Oct 10 2:01 AM ET, which /proof no longer
// offers as that evidence.
const EARLIER_REDEEM_TX = "5tEKu2mtrdzu9hVaXCmkGyq9Y6mTobNVBmVx5ji59hku2bf28E3okmJatw7WbPRqfHHpLf9wyC1SbjwU3PWD5rAa";
const DEVNET = /^https:\/\/api\.devnet\.solana\.com\/?$/;
const DEVNET_WS = /^wss:\/\/api\.devnet\.solana\.com\/?$/;
// Why a read on the failing server did not succeed: nothing listens there, or this server's
// read budget held a further attempt back (lib/read-state.ts ReadGate).
const FAILED_READ = /127\.0\.0\.1:3191|did not read again|waits \d+ s more/;

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

const WORKFLOW_FILES = readdirSync(path.join(repoRoot, ".github", "workflows"))
  .filter((f) => f.endsWith(".yml"))
  .map((f) => f.replace(/\.yml$/, ""));

test("/judge: seven numbered stops, the program facts and each workflow's result, read by the server", async ({ page, baseURL }) => {
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
  // The success path, every run: the stand-in's facts, never a failure notice.
  await expect(page.getByTestId("read-failure")).toHaveCount(0);
  await expect(page.getByTestId("program-facts")).toBeVisible();
  await expect(page.getByTestId("fact-executable")).toHaveText("Yes, executable");
  await expect(page.getByTestId("fact-authority")).toContainText(pins.upgradeAuthority);
  await expect(page.getByTestId("fact-deployed")).toContainText(`Slot ${EXPECTED.deploySlot}`);
  await expect(page.getByTestId("fact-size")).toHaveText(`${EXPECTED.programBytes.toLocaleString("en-US")} bytes`);
  await expect(page.getByTestId("fact-vault")).toContainText(`${EXPECTED.vault} sandbox USDC`);
  await expect(page.getByTestId("fact-init")).toContainText("initialize_vault");
  await expect(page.getByTestId("fact-init")).toContainText("Succeeded");
  await expect(page.getByTestId("init-explorer-link")).toHaveAttribute("href", `https://explorer.solana.com/tx/${INIT_TX}?cluster=devnet`);
  await expect(page.getByTestId("count-VaultConfig")).toHaveText(`Config: ${EXPECTED.counts.VaultConfig}`);
  await expect(page.getByTestId("count-VaultAuthority")).toHaveText(`Vault authority: ${EXPECTED.counts.VaultAuthority}`);
  await expect(page.getByTestId("count-Allowance")).toHaveText(`Allowances: ${EXPECTED.counts.Allowance}`);
  await expect(page.getByTestId("count-Merchant")).toHaveText(`Merchants: ${EXPECTED.counts.Merchant}`);
  await expect(page.getByTestId("program-read-stamp")).toContainText(/Read from Solana devnet at slots? \d+/);
  await expect(page.getByTestId("program-read-stamp")).toHaveAttribute("data-stale", "false");

  await expect(page.getByTestId("testflight-status")).toHaveText(
    "TestFlight build 1 has been in Apple beta review since Sat Oct 10 12:05 AM ET, and the public link appears here once Apple approves. The team runs build 5, with the scanner fix, through internal TestFlight.",
  );
  await expect(page.getByTestId("repo-link")).toHaveAttribute("href", "https://github.com/StephenSook/loka-pay");
  // Every workflow in .github/workflows has its line, so a red one cannot be left out, and
  // each shows the result the stand-in reports for main's latest commit.
  expect(WORKFLOW_FILES.length).toBeGreaterThanOrEqual(6);
  await expect(page.getByRole("list", { name: "GitHub Actions workflows" }).getByRole("listitem")).toHaveCount(WORKFLOW_FILES.length);
  await expect(page.getByTestId("ci-read-failure")).toHaveCount(0);
  await expect(page.getByTestId("ci-read-stamp")).toContainText(`Read from GitHub's API at main's latest commit ${EXPECTED.mainCommit}`);
  for (const file of WORKFLOW_FILES) {
    const line = page.getByTestId(`ci-${file}`);
    await expect(line, file).toHaveAttribute("data-result", EXPECTED.ci[file]);
    await expect(line.getByTestId("ci-result")).toHaveText(EXPECTED.ci[file] === "success" ? "Passed" : "Failed");
    await expect(line.getByRole("link")).toHaveAttribute("href", /^https:\/\/github\.com\/StephenSook\/loka-pay\/actions\/runs\/\d+\/job\/\d+$/);
  }
  // The stand-in's server job failed, so the note about it is shown. The server code is merged,
  // so the note points at the deployed server's own commit instead of saying it is unmerged.
  const serverNote = page.getByTestId("server-workflow-note");
  await expect(serverNote).toContainText(
    "The server workflow tests the settlement server code in server/ on main's latest commit. The server deployed at api.zerobars.us reports the commit it runs on its health check:",
  );
  await expect(serverNote).not.toContainText("merged");
  await expect(serverNote.getByTestId("server-health-link")).toHaveAttribute("href", "https://api.zerobars.us/api/health");
  // No image from GitHub: a hotlinked badge would send the visitor's GitHub cookies with it.
  await expect(page.locator("img")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(foreign).toEqual([]);
});

test("/trust: pilot status from the authority read, custody, the checks and the limits; no request leaves the site", async ({ page, baseURL }) => {
  const foreign = watchForeign(page, baseURL!);
  await open(page, "/trust");
  // The heading follows the upgrade authority read (lib/claims.ts upgradeability): said in
  // the present only from a current read, otherwise as of the dated read.
  const pilot = page.getByTestId("pilot-status");
  await expect(pilot).toHaveAttribute("data-upgradeability", "upgradeable");
  const pilotAsOf = await pilot.getAttribute("data-as-of");
  expect(["current", "dated"]).toContain(pilotAsOf);
  await expect(pilot).toHaveText(
    pilotAsOf === "current"
      ? "Devnet pilot, unaudited, not frozen on purpose."
      : /^Devnet pilot, unaudited\. Not frozen on purpose, as of a devnet read \d+ (s|min) ago\.$/,
  );
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
    await expect(server).toHaveText(
      "Its Ed25519 key is not published in config/pins.json yet, so no phone can check a confirmation it signs.",
    );
  } else {
    await expect(server).toContainText(pins.serverEd25519PublicKey);
  }
  await expect(page.getByTestId("read-failure")).toHaveCount(0);
  await expect(page.getByTestId("upgrade-authority")).toHaveText(pins.upgradeAuthority);
  await expect(page.getByTestId("custody-authority")).toContainText("A 2-of-3 multisig is planned (task 3.46), not done.");
  // The custody sentence is in the banner's tense: "today" only from a current read.
  const sentence = page.getByTestId("authority-sentence");
  await expect(sentence).toHaveAttribute("data-as-of", pilotAsOf!);
  await expect(sentence).toHaveText(
    pilotAsOf === "current"
      ? "One key, held by one teammate, can upgrade the program today. A 2-of-3 multisig is planned (task 3.46), not done."
      : /^As of that read, \d+ (s|min) old when this page loaded, one key, held by one teammate, could upgrade the program\. A 2-of-3 multisig is planned \(task 3\.46\), not done\.$/,
  );
  await expect(page.getByTestId("custody-vault")).toContainText(`${EXPECTED.vault} sandbox USDC`);
  await expect(page.getByRole("main")).toContainText("Double spending is bounded, not prevented.");
  await page.waitForLoadState("networkidle");
  expect(foreign).toEqual([]);
});

// Claims a read decides, with the source it names and the most its read may age for a Live
// claim (lib/chain.ts CHAIN_READS, lib/github.ts GITHUB_READS, lib/settlement.ts
// SETTLEMENT_READS: 10 s, 60 s and 10 s).
const READ_BACKED: Record<string, { source: string; maxAgeS: number }> = {
  deployed: { source: "Solana devnet", maxAgeS: 10 },
  initialized: { source: "Solana devnet", maxAgeS: 10 },
  precompile: { source: "Solana devnet", maxAgeS: 10 },
  reserves: { source: "Solana devnet", maxAgeS: 10 },
  redeemed: { source: "Solana devnet", maxAgeS: 10 },
  "program-ci": { source: "GitHub", maxAgeS: 60 },
  server: { source: "api.zerobars.us", maxAgeS: 10 },
};

/** Every claim on /proof by id: its status, after checking the rules each status must follow. */
async function readClaims(page: Page): Promise<Record<string, string | null>> {
  const claims = page.locator('[data-testid^="claim-"][data-status]');
  expect(await claims.count()).toBeGreaterThanOrEqual(8);
  const statusOf: Record<string, string | null> = {};
  for (const claim of await claims.all()) {
    const id = (await claim.getAttribute("data-testid"))!.replace(/^claim-/, "");
    const status = await claim.getAttribute("data-status");
    statusOf[id] = status;
    const evidence = claim.getByTestId("claim-evidence");
    const checked = claim.getByTestId("claim-checked");
    if (status === "live") {
      await expect(evidence).toHaveCount(1);
      await expect(claim.getByTestId("claim-status")).toHaveText("Live");
      // Every Live claim has a read behind it: the read that decided it, by source, with an
      // age inside that read's window.
      const backing = READ_BACKED[id];
      expect(backing, `${id} is Live without a read behind it`).toBeDefined();
      const text = await checked.innerText();
      const m = text.match(/^Checked against (.+) at .+ ET, (\d+) s before this page loaded\.$/);
      expect(m, `${id}: "${text}"`).not.toBeNull();
      expect(m![1]).toBe(backing.source);
      expect(Number(m![2])).toBeLessThanOrEqual(backing.maxAgeS);
    } else if (status === "available") {
      // A page to run yourself: linked, never called Live, no read claimed, and it says why.
      await expect(evidence).toHaveCount(1);
      await expect(checked).toHaveCount(0);
      await expect(claim.getByTestId("claim-status")).toHaveText("Available");
      await expect(claim.getByTestId("claim-note")).not.toBeEmpty();
    } else {
      await expect(evidence).toHaveCount(0);
      await expect(claim.getByTestId("claim-evidence-more")).toHaveCount(0);
      await expect(checked).toHaveCount(0);
      await expect(claim.getByTestId("claim-status")).toHaveText(status === "building" ? "Building" : "Not checked");
      // A claim that is not Live says why.
      await expect(claim.getByTestId("claim-note")).not.toBeEmpty();
    }
  }
  for (const id of Object.keys(READ_BACKED)) expect(statusOf[id], id).toBeDefined();
  // This server cannot see a visitor's WebSocket, so the live feed claim is never Live, and
  // the verifier runs in the visitor's browser, so it is Available, not Live.
  expect(statusOf.live).toBe("unchecked");
  expect(statusOf.verify).toBe("available");
  await expect(page.getByTestId("claim-testflight")).toHaveAttribute("data-status", "building");
  // The same dated status as /judge step 6.
  await expect(page.getByTestId("claim-testflight")).toContainText(
    "TestFlight build 1 has been in Apple beta review since Sat Oct 10 12:05 AM ET, and the public link appears here once Apple approves. The team runs build 5, with the scanner fix, through internal TestFlight. Status as of 2026-10-10.",
  );
  return statusOf;
}

test("/proof: every read-backed claim Live from its current read, exact reserves, the commit count; no request leaves the site", async ({
  page,
  baseURL,
  request,
}) => {
  const foreign = watchForeign(page, baseURL!);
  await open(page, "/proof");
  const statusOf = await readClaims(page);
  // The success path, every run: each read-backed claim is Live from the stand-in's reads.
  for (const id of Object.keys(READ_BACKED)) expect(statusOf[id], id).toBe("live");
  // A redeemed note is evidenced by the first iPhone payment itself, which cannot scroll off
  // /live's newest rows; /live is the second link. The 2:01 AM test-key redeem is not used.
  const redeemed = page.getByTestId("claim-redeemed");
  await expect(redeemed.getByTestId("claim-evidence")).toHaveAttribute("href", `https://explorer.solana.com/tx/${IPHONE_SETTLED_TX}?cluster=devnet`);
  await expect(redeemed.getByTestId("claim-evidence")).toContainText("The first iPhone payment, settled Sat Oct 10 4:23 PM ET");
  await expect(redeemed.locator(`a[href*="${EARLIER_REDEEM_TX}"]`)).toHaveCount(0);
  await expect(redeemed.getByTestId("claim-evidence-more")).toHaveAttribute("href", "/live");
  await expect(page.getByTestId("claim-precompile").getByTestId("claim-evidence")).toContainText("active since slot 380592000");
  await expect(page.getByTestId("claim-program-ci").getByTestId("claim-evidence")).toContainText(`(${EXPECTED.mainCommit})`);
  // The server claim: Live from the stand-in's health answer, linking the real health check.
  const server = page.getByTestId("claim-server");
  await expect(server.getByTestId("claim-evidence")).toHaveAttribute("href", "https://api.zerobars.us/api/health");
  await expect(server.getByTestId("claim-evidence")).toContainText(`slot ${HEALTH.slot}, commit ${HEALTH.commit.slice(0, 7)}`);
  await expect(server.getByTestId("claim-evidence-more")).toHaveAttribute("href", "https://github.com/StephenSook/loka-pay/tree/main/server");
  await expect(server).not.toContainText("not live");

  // Proof of reserves: the stand-in's amounts exactly, and liabilities plus the difference
  // equal the assets, as printed, compared in base units. Every field must show an amount.
  await expect(page.locator("#reserves").getByTestId("read-failure")).toHaveCount(0);
  await expect(page.getByTestId("reserves")).toBeVisible();
  const baseUnits = async (id: string): Promise<bigint> => {
    const text = (await page.getByTestId(id).innerText()).trim();
    const m = text.match(/^(-?)(\d{1,3}(?:,\d{3})*)\.(\d{2,6}) sandbox USDC$/);
    expect(m, `${id} shows "${text}", not an amount`).not.toBeNull();
    const units = BigInt(m![2].replace(/,/g, "")) * BigInt(1_000_000) + BigInt(m![3].padEnd(6, "0"));
    return m![1] === "-" ? -units : units;
  };
  for (const [id, expected] of [
    ["reserves-assets", EXPECTED.reserves.assets],
    ["reserves-allowances", EXPECTED.reserves.allowances],
    ["reserves-bonds", EXPECTED.reserves.bonds],
    ["reserves-merchants", EXPECTED.reserves.merchants],
    ["reserves-liabilities", EXPECTED.reserves.liabilities],
    ["reserves-difference", EXPECTED.reserves.difference],
  ] as const) {
    await expect(page.getByTestId(id)).toHaveText(`${expected} sandbox USDC`);
  }
  const assets = await baseUnits("reserves-assets");
  const liabilities = await baseUnits("reserves-liabilities");
  const difference = await baseUnits("reserves-difference");
  const parts = (await baseUnits("reserves-allowances")) + (await baseUnits("reserves-bonds")) + (await baseUnits("reserves-merchants"));
  expect(liabilities).toBe(parts);
  expect(assets - liabilities).toBe(difference);
  await expect(page.getByTestId("reserves-verdict")).toHaveText(EXPECTED.reserves.verdict);
  // The slots it names are in order: listed, then every balance, then listed again at or after it.
  const stampText = await page.getByTestId("reserves-read-stamp").innerText();
  const slots = stampText.match(/slot (\d+), every balance in one call \(accounts listed at slot (\d+) and checked again at slot (\d+)\)/);
  expect(slots, stampText).not.toBeNull();
  const [read, listed, check] = [Number(slots![1]), Number(slots![2]), Number(slots![3])];
  expect(listed).toBeLessThanOrEqual(read);
  expect(check).toBeGreaterThanOrEqual(read);
  // The reserves claim is Live, and the panel shows the same current read.
  await expect(page.getByTestId("reserves-read-stamp")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("reserves-not-shown")).toContainText("Bounty and operator credits");

  // Built this weekend: the stand-in's compare answer, exactly.
  await expect(page.getByTestId("built-label")).toContainText("since hacking started, Fri Oct 9 8:08 PM ET");
  await expect(page.getByTestId("compare-link")).toHaveAttribute(
    "href",
    "https://github.com/StephenSook/loka-pay/compare/pre-hacklanta-kit...main",
  );
  await expect(page.getByTestId("built-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("built-commits")).toHaveText(String(EXPECTED.commits));
  await expect(page.getByTestId("built-authors")).toHaveText(String(EXPECTED.authors.length));
  await expect(page.getByTestId("built-files")).toHaveText(String(EXPECTED.filesChanged));
  await expect(page.getByTestId("built-additions")).toHaveText(EXPECTED.additions);
  await expect(page.getByTestId("built-additions-note")).toContainText(
    `GitHub gave no line count for ${EXPECTED.filesWithoutLineCount} of the ${EXPECTED.filesChanged} files`,
  );
  await expect(page.getByTestId("built-additions-note")).toContainText("git diff --shortstat pre-hacklanta-kit main");
  await expect(page.getByTestId("built-logins")).toContainText(EXPECTED.authors.join(", "));

  // GITHUB_TOKEN: the server sent it to the configured GitHub API, and the page never shows it.
  const seen = (await (await request.get(`${UPSTREAM}/__seen`)).json()) as { githubAuthorization: string[] };
  expect(seen.githubAuthorization.length).toBeGreaterThan(0);
  for (const header of seen.githubAuthorization) expect(header).toBe(`Bearer ${E2E_GITHUB_TOKEN}`);
  expect(await page.content()).not.toContain(E2E_GITHUB_TOKEN);
  await page.waitForLoadState("networkidle");
  expect(foreign).toEqual([]);
});

// ---------- the failure path: the second e2e server, whose reads all fail ----------

test("failing reads: /judge says each read failed and shows no fact and no workflow result", async ({ page }) => {
  await open(page, `${FAILING_URL}/judge`);
  await expect(page.getByTestId("program-facts")).toHaveCount(0);
  const failure = page.getByTestId("read-failure");
  await expect(failure).toContainText("Could not read the program from devnet.");
  await expect(failure).toContainText(FAILED_READ);
  await expect(page.getByTestId("ci-read-failure")).toContainText("Could not read the workflow results from GitHub.");
  await expect(page.getByTestId("ci-read-stamp")).toHaveCount(0);
  for (const file of WORKFLOW_FILES) {
    // No read, no result: never a status from nowhere.
    await expect(page.getByTestId(`ci-${file}`)).toHaveAttribute("data-result", "not-read");
    await expect(page.getByTestId(`ci-${file}`).getByTestId("ci-result")).toHaveCount(0);
  }
  await expect(page.getByTestId("server-workflow-note")).toHaveCount(0);
});

test("failing reads: /trust says whether it can be upgraded is not known, and why", async ({ page }) => {
  await open(page, `${FAILING_URL}/trust`);
  const pilot = page.getByTestId("pilot-status");
  await expect(pilot).toHaveAttribute("data-upgradeability", "unknown");
  await expect(pilot).toHaveText("Devnet pilot, unaudited. Whether it can still be upgraded is not known right now.");
  await expect(page.getByTestId("read-failure")).toContainText(FAILED_READ);
  await expect(page.getByTestId("upgrade-authority")).toHaveCount(0);
});

test("failing reads: /proof calls nothing Live, says why for each claim, and shows no reserves or count", async ({ page }) => {
  await open(page, `${FAILING_URL}/proof`);
  const statusOf = await readClaims(page);
  expect(Object.values(statusOf)).not.toContain("live");
  for (const id of Object.keys(READ_BACKED)) {
    expect(statusOf[id], id).toBe("unchecked");
    await expect(page.getByTestId(`claim-${id}`).getByTestId("claim-note")).toContainText(FAILED_READ);
  }
  await expect(page.getByTestId("reserves")).toHaveCount(0);
  await expect(page.locator("#reserves").getByTestId("read-failure")).toContainText("Could not read the reserves from devnet.");
  await expect(page.getByTestId("built-commits")).toHaveCount(0);
  await expect(page.getByTestId("built-unavailable")).toContainText("Could not read the commit count from GitHub.");
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
