import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// /verify (PLAN.md 3.2): the browser checks a receipt locally. Expected values are read
// from the published vectors file here, not imported from the app, so a wrong page value
// fails instead of passing by construction.

const repoRoot = path.resolve(__dirname, "..", "..");
const vectors = JSON.parse(readFileSync(path.join(repoRoot, "protocol", "vectors", "payment-v1.json"), "utf8"));
// The page treats a pins file whose server key is still null like a missing file
// (web/lib/deployment.ts), so "present" here means present with a server key.
const pinsFile = path.join(repoRoot, "config", "pins.json");
const pinsPresent =
  existsSync(pinsFile) && JSON.parse(readFileSync(pinsFile, "utf8")).serverEd25519PublicKey !== null;

// Only some vector receipts carry `verifyUrlFragment`; `fragment` is built from the
// transport payload for every one (PAYMENT-V1 section 4.9: "#r=<base64url>").
type VectorReceipt = { name: string; wireHex: string; transport: string; verifyUrlFragment?: string };
const receiptNamed = (name: string) => {
  const found = (vectors.receipts as VectorReceipt[]).find((r) => r.name === name);
  if (!found) throw new Error(`no vector receipt named ${name}`);
  return { ...found, fragment: `r=${found.transport.split("|")[4]}` };
};
const withConf = receiptNamed("note_0_with_confirmation");
const withoutConf = receiptNamed("note_0_without_confirmation");
type VectorConf = { name: string; wireHex: string; fields: Record<string, string | number> };
const confNamed = (name: string): VectorConf => {
  const found = (vectors.confs as VectorConf[]).find((c) => c.name === name);
  if (!found) throw new Error(`no vector confirmation named ${name}`);
  return found;
};
const settledConf = confNamed("settled").fields;
const ack = vectors.acks[0].fields;
const note = vectors.notes[0];

/**
 * A receipt assembled from published vector bytes only (PAYMENT-V1 section 4.9):
 * note wire || ack wire || flag 1 || conf wire. Every conf vector names note 0.
 */
function receiptWithConf(conf: VectorConf): string {
  return Buffer.from(`${note.wireHex}${vectors.acks[0].wireHex}01${conf.wireHex}`, "hex").toString("base64url");
}

const PINS_NOTICE =
  "The settlement server's key is not published yet, so confirmations cannot be checked on this page.";

/** The receipt bytes with one byte XOR-ed, as base64url (no padding, as PAYMENT-V1 section 5 requires). */
function flipped(hex: string, offset: number): string {
  const bytes = Buffer.from(hex, "hex");
  bytes[offset] ^= 0x01;
  return bytes.toString("base64url");
}

/** Records every request, so a test can show the receipt never left the page. */
function watchRequests(page: Page, baseURL: string) {
  const own = new URL(baseURL).origin;
  const seen = { urls: [] as string[], foreign: [] as string[], bodies: [] as string[], methods: [] as string[] };
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    seen.urls.push(req.url());
    seen.methods.push(req.method());
    seen.bodies.push(req.postData() ?? "");
    if (url.origin !== own) seen.foreign.push(req.url());
  });
  return seen;
}

async function open(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response, `no response for ${url}`).not.toBeNull();
  expect(response!.status()).toBe(200);
  expect((await response!.allHeaders())["set-cookie"]).toBeUndefined();
}

async function expectAllChecks(page: Page, states: Record<"note" | "ack" | "conf" | "ids", string>) {
  for (const [id, state] of Object.entries(states)) {
    await expect(page.getByTestId(`check-${id}`), `check ${id}`).toHaveAttribute("data-state", state);
  }
}

async function expectSettledVector(page: Page) {
  // The vector's confirmation is status 1; the page must say so from the signed CONF.
  expect(settledConf.statusCode).toBe(1);
  await expect(page.getByTestId("receipt-status")).toHaveText("Settled");
  await expectAllChecks(page, { note: "passed", ack: "passed", conf: "passed", ids: "passed" });
  await expect(page.getByTestId("test-vector-notice")).toContainText("Test vector, not a real payment.");
  await expect(page.getByTestId("test-vector-notice")).toContainText("public test keys");
  await expect(page.getByTestId("field-amount")).toHaveText("1.00 sandbox USD");
  await expect(page.getByTestId("field-note-id")).toHaveText(note.noteIdHex);
  await expect(page.getByTestId("field-conf-status")).toHaveText("Settled (status 1)");
  const held = BigInt(settledConf.uploadedAt) - BigInt(ack.receivedAt);
  await expect(page.getByTestId("field-held-offline")).toContainText(`${held} s`);
  await expect(page.getByTestId("field-held-offline")).toContainText("server clock");
  await expect(page.getByTestId("field-held-offline")).toContainText("merchant phone clock");
  await expect(page.getByTestId("explorer-link")).toHaveAttribute(
    "href",
    `https://explorer.solana.com/tx/${settledConf.txSignatureBase58}?cluster=devnet`,
  );
}

test("the published test receipt shows Settled and every check passes, with no request carrying it", async ({
  page,
  context,
  baseURL,
}) => {
  const seen = watchRequests(page, baseURL!);
  await open(page, "/verify");
  await expect(page.getByTestId("verify-result")).toContainText("Nothing checked yet.");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Try the published test receipt" }).click();
  await expectSettledVector(page);
  await expect(page.getByRole("textbox", { name: "Receipt" })).toHaveValue(withConf.transport);

  // The check made no request with the receipt in it, and nothing went to another origin.
  const payload = withConf.transport.split("|")[4];
  const probe = payload.slice(40, 80);
  expect(seen.urls.length).toBeGreaterThan(2); // the watcher saw the page load
  expect(seen.urls.filter((u) => u.includes(probe))).toEqual([]);
  expect(seen.bodies.filter((b) => b.includes(probe))).toEqual([]);
  expect(seen.methods.filter((m) => m !== "GET")).toEqual([]);
  expect(seen.foreign).toEqual([]);
  expect(await context.cookies()).toEqual([]);
});

test("one flipped byte in the note fails and names bad_signature in the note signature check", async ({
  page,
}, testInfo) => {
  await open(page, "/verify");
  // Offset 128 is the last byte of the note's amount (NOTE_V1 section 4.1).
  await page.getByRole("textbox", { name: "Receipt" }).fill(flipped(withConf.wireHex, 128));
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  await expect(page.getByTestId("receipt-status")).toHaveText("Not verified");
  await expect(page.getByTestId("failure-code")).toHaveText("bad_signature");
  await expect(page.getByTestId("failed-check")).toHaveText("Failed check: Note signature");
  await expect(page.getByTestId("verify-result")).toContainText("The signature does not match");
  await expectAllChecks(page, { note: "failed", ack: "not_run", conf: "not_run", ids: "not_run" });
  // Nothing from an unverified receipt is shown as a fact.
  await expect(page.getByTestId("field-amount")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("verify-failed.png"), fullPage: true });
});

test("dark mode: the verified receipt keeps the warm night background", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page, `/verify#${withConf.fragment}`);
  await expect(page.getByTestId("receipt-status")).toHaveText("Settled");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(20, 22, 58)");
  await page.screenshot({ path: testInfo.outputPath("verify-dark-390.png"), fullPage: true });
});

test("one flipped byte in the confirmation signature names the server confirmation check", async ({ page }) => {
  await open(page, "/verify");
  const lastByte = Buffer.from(withConf.wireHex, "hex").length - 1;
  await page.getByRole("textbox", { name: "Receipt" }).fill(flipped(withConf.wireHex, lastByte));
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  await expect(page.getByTestId("receipt-status")).toHaveText("Not verified");
  await expect(page.getByTestId("failure-code")).toHaveText("bad_signature");
  await expect(page.getByTestId("failed-check")).toHaveText("Failed check: Server confirmation signature");
  await expectAllChecks(page, { note: "passed", ack: "passed", conf: "failed", ids: "not_run" });
});

test("a #r= fragment link verifies on load", async ({ page }) => {
  // The fragment exactly as the vectors file publishes it.
  expect(withConf.verifyUrlFragment).toBe(withConf.fragment);
  await open(page, `/verify#${withConf.verifyUrlFragment}`);
  await expectSettledVector(page);
  await expect(page.getByTestId("verify-result")).toContainText("From the link");
});

test("failed and refused confirmations show their own status, from the signed CONF", async ({ page }) => {
  // The assembly reproduces the published receipt exactly, so the other two are real vector bytes too.
  expect(receiptWithConf(confNamed("settled"))).toBe(withConf.fragment.slice(2));

  const failed = confNamed("failed_on_chain_serial_used");
  expect(failed.fields.statusCode).toBe(2);
  await open(page, `/verify#r=${receiptWithConf(failed)}`);
  await expect(page.getByTestId("receipt-status")).toHaveText("Failed on chain");
  await expectAllChecks(page, { note: "passed", ack: "passed", conf: "passed", ids: "passed" });
  await expect(page.getByTestId("field-conf-status")).toHaveText("Failed on chain (status 2)");
  await expect(page.getByTestId("verify-result")).toContainText(`Program error code ${failed.fields.errorCode}.`);
  await expect(page.getByTestId("explorer-link")).toHaveAttribute(
    "href",
    `https://explorer.solana.com/tx/${failed.fields.txSignatureBase58}?cluster=devnet`,
  );

  const refused = confNamed("refused_off_chain");
  expect(refused.fields.statusCode).toBe(3);
  await page.evaluate((fragment) => {
    window.location.hash = fragment;
  }, `r=${receiptWithConf(refused)}`);
  await expect(page.getByTestId("receipt-status")).toHaveText("Refused");
  await expect(page.getByTestId("field-conf-status")).toHaveText("Refused before reaching the chain (status 3)");
  // A refused note never reached the chain, so there is no transaction to link.
  await expect(page.getByTestId("explorer-link")).toHaveCount(0);
});

test("a receipt with no confirmation is Pending, and a new fragment re-verifies", async ({ page }) => {
  await open(page, `/verify#${withoutConf.fragment}`);
  await expect(page.getByTestId("receipt-status")).toHaveText("Pending");
  await expectAllChecks(page, { note: "passed", ack: "passed", conf: "not_attached", ids: "passed" });
  await expect(page.getByTestId("field-conf-status")).toHaveText("No confirmation attached");
  await expect(page.getByTestId("explorer-link")).toHaveCount(0);
  await expect(page.getByTestId("field-held-offline")).toHaveCount(0);

  await page.evaluate((fragment) => {
    window.location.hash = fragment;
  }, withConf.fragment);
  await expect(page.getByTestId("receipt-status")).toHaveText("Settled");
});

test("the query string is never read", async ({ page }) => {
  await open(page, `/verify?${withConf.fragment}`);
  await expect(page.getByTestId("verify-result")).toContainText("Nothing checked yet.");
});

test("a receipt for another deployment is not shown as verified", async ({ page }) => {
  await open(page, "/verify");
  // Offset 16 is the first byte of the note's program id: no longer the vector deployment.
  await page.getByRole("textbox", { name: "Receipt" }).fill(flipped(withConf.wireHex, 16));
  await page.getByRole("button", { name: "Verify", exact: true }).click();

  if (pinsPresent) {
    await expect(page.getByTestId("receipt-status")).toHaveText("Not verified");
    await expect(page.getByTestId("failure-code")).toHaveText("wrong_program");
  } else {
    await expect(page.getByTestId("receipt-status")).toHaveText("Not checked");
    await expect(page.getByTestId("pins-notice")).toContainText(PINS_NOTICE);
    await expect(page.getByTestId("deployment-unpublished")).toHaveText(PINS_NOTICE);
  }
  await expect(page.getByTestId("test-vector-notice")).toHaveCount(0);
  await expect(page.getByTestId("check-note")).toHaveCount(pinsPresent ? 1 : 0);
});

test("other payment content and bad text are refused by name", async ({ page }) => {
  await open(page, "/verify");
  const box = page.getByRole("textbox", { name: "Receipt" });
  const verify = page.getByRole("button", { name: "Verify", exact: true });

  await box.fill(vectors.acks[0].transport);
  await verify.click();
  await expect(page.getByTestId("receipt-status")).toHaveText("Not a receipt");
  await expect(page.getByTestId("verify-result")).toContainText("That is an acknowledgement, not a receipt.");

  await box.fill(`${withConf.transport.split("|")[4]}=`);
  await verify.click();
  await expect(page.getByTestId("failure-code")).toHaveText("base64url");
});

test("an oversized paste or #r= link is refused before any decoding", async ({ page }) => {
  // Alphabet-valid, so only the length guard can stop it; a 600 KB link must not stall the tab.
  const huge = "A".repeat(600_000);
  await open(page, `/verify#r=${huge}`);
  await expect(page.getByTestId("receipt-status")).toHaveText("Not a receipt");
  await expect(page.getByTestId("verify-result")).toContainText("A receipt is under 900");

  const box = page.getByRole("textbox", { name: "Receipt" });
  await box.fill("A".repeat(5_000));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByTestId("verify-result")).toContainText("5,000 characters");
});

test("keyboard only: reach the test receipt button and press Enter", async ({ page, browserName }) => {
  await open(page, "/verify");
  const tryButton = page.getByRole("button", { name: "Try the published test receipt" });
  if (browserName === "webkit") {
    // WebKit's default Tab moves between text fields only (Safari's "Press Tab to
    // highlight each item" is off), so focus the button and test Enter there.
    await tryButton.focus();
  } else {
    await page.getByRole("textbox", { name: "Receipt" }).focus();
    await page.keyboard.press("Tab"); // Verify
    await page.keyboard.press("Tab"); // Try the published test receipt
  }
  await expect(tryButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("receipt-status")).toHaveText("Settled");
  await expect(page.getByTestId("verify-result")).toBeFocused();
});

for (const width of [390, 1440]) {
  test(`no sideways scroll at ${width} px with a verified receipt on screen`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, `/verify#${withConf.fragment}`);
    await expect(page.getByTestId("receipt-status")).toHaveText("Settled");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // A still for review (test-results/ is not committed).
    await page.screenshot({ path: testInfo.outputPath(`verify-${width}.png`), fullPage: true });
  });
}
