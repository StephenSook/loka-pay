import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// "Play the attacker" on /verify (PLAN.md 3.52, the browser part). Expected bytes and words
// are computed here from protocol/vectors/payment-v1.json and the PAYMENT-V1 section 4.1
// offsets, not imported from the app, so a wrong page value fails instead of agreeing with
// itself.

const repoRoot = path.resolve(__dirname, "..", "..");
const vectors = JSON.parse(readFileSync(path.join(repoRoot, "protocol", "vectors", "payment-v1.json"), "utf8"));
const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");

const note = vectors.notes.find((n: { name: string }) => n.name === "one_dollar_serial_0");
const merchantB: { keyHashHex: string } = vectors.keys.merchantB;
const flippedReceipt = (() => {
  const receipt = vectors.receipts.find((r: { name: string }) => r.name === "note_0_with_confirmation");
  const b = Buffer.from(receipt.wireHex, "hex");
  b[128] ^= 0x01;
  return b.toString("base64url");
})();

// PAYMENT-V1 section 4.1: allowance id at 81 (8 bytes), payee key hash at 89 (32), amount
// at 121 (8), serial at 132 (1), expiry at 133 (8).
const AMOUNT_AT = 121;
const PAYEE_AT = 89;

/** "byte 128", "bytes 125 to 128", or "bytes 89 to 95, 97 to 120 and 125 to 128". */
function describePositions(positions: number[]): string {
  const runs: Array<[number, number]> = [];
  for (const p of positions) {
    const last = runs[runs.length - 1];
    if (last && last[1] === p - 1) last[1] = p;
    else runs.push([p, p]);
  }
  if (runs.length === 1) return runs[0][0] === runs[0][1] ? `byte ${runs[0][0]}` : `bytes ${runs[0][0]} to ${runs[0][1]}`;
  const parts = runs.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`));
  return `bytes ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function differing(a: Buffer, b: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) out.push(i);
  return out;
}

const signedNote = Buffer.from(note.noteHex, "hex");

/** The positions an amount edit changes: the new u64 written big-endian at 121. */
function amountPositions(units: bigint): number[] {
  const edited = Buffer.from(signedNote);
  edited.writeBigUInt64BE(units, AMOUNT_AT);
  return differing(signedNote, edited);
}

/** The positions a payee edit changes: the new 32-byte key hash at 89. */
function payeePositions(keyHashHex: string): number[] {
  const edited = Buffer.from(signedNote);
  Buffer.from(keyHashHex, "hex").copy(edited, PAYEE_AT);
  return differing(signedNote, edited);
}

const short = (hex: string) => `${hex.slice(0, 8)}...${hex.slice(-8)}`;

// What the check shows, and nothing more: the retained signature fails over the edited
// bytes. It must not claim the payer never signed them (see the equivocation test below).
const MISMATCH = "The original signature does not match these edited bytes.";

async function openWithTestReceipt(page: Page) {
  const response = await page.goto("/verify");
  expect(response?.status()).toBe(200);
  await page.getByRole("button", { name: "Try the published test receipt" }).click();
  await expect(page.getByTestId("receipt-status")).toHaveText("Settled");
  await expect(page.getByTestId("test-vector-notice")).toBeVisible();
  const panel = page.getByTestId("attacker-panel");
  await expect(panel.getByRole("heading", { name: "Play the attacker" })).toBeVisible();
  return panel;
}

test("the test receipt verifies, an amount edit fails the signature within 1 s, and undo restores the match", async ({
  page,
}, testInfo) => {
  const panel = await openWithTestReceipt(page);
  await expect(panel.getByTestId("attacker-local")).toContainText("not sent anywhere and nothing is stored");

  // The fields, decoded from the 141 bytes, each with its byte range.
  expect(note.fields.amount).toBe("1000000");
  await expect(panel.getByTestId("note-field-amount-value")).toHaveText("1.00 sandbox USD (1,000,000 base units)");
  await expect(panel.getByTestId("note-field-amount-range")).toHaveText("bytes 121 to 128");
  await expect(panel.getByTestId("note-field-payeeKeyHash-range")).toHaveText("bytes 89 to 120");
  await expect(panel.getByTestId("note-field-payeeKeyHash-value")).toContainText(short(note.fields.payeeKeyHashHex));
  await expect(panel.getByTestId("note-field-allowanceId-range")).toHaveText("bytes 81 to 88");
  await expect(panel.getByTestId("note-field-allowanceId-value")).toHaveText(note.fields.allowanceId);
  await expect(panel.getByTestId("note-field-serial-range")).toHaveText("byte 132");
  await expect(panel.getByTestId("note-field-serial-value")).toHaveText(String(note.fields.serial));
  await expect(panel.getByTestId("note-field-expiry-range")).toHaveText("bytes 133 to 140");
  await expect(panel.getByTestId("note-field-expiry-value")).toContainText(`${note.fields.expiry} unix seconds`);

  const result = panel.getByTestId("attacker-result");
  await expect(result).toHaveAttribute("data-outcome", "matches");
  await expect(panel.getByTestId("attacker-chip")).toHaveText("Signature matches");

  // The edit: 1.00 to 100.00.
  const positions = amountPositions(BigInt(100_000_000));
  expect(positions).toEqual([125, 126, 127, 128]); // 0x0f4240 against 0x05f5e100
  const amountBox = panel.getByRole("textbox", { name: "Amount (sandbox USD)" });
  await expect(amountBox).toHaveValue("1.00");
  const started = Date.now();
  await amountBox.fill("100.00");
  await expect(panel.getByTestId("attacker-verdict")).toHaveText(MISMATCH, { timeout: 1000 });
  await expect(panel.getByTestId("attacker-changed")).toHaveText(
    `${positions.length} of 141 bytes changed: ${describePositions(positions)} (amount).`,
    { timeout: 1000 },
  );
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(1000);
  testInfo.annotations.push({ type: "edit to failure", description: `${elapsed} ms` });

  // The result is announced: it is inside the polite live region.
  await expect(page.getByRole("status").filter({ hasText: MISMATCH })).toHaveCount(1);
  await expect(result).toHaveAttribute("data-outcome", "signature_mismatch");
  await expect(panel.getByTestId("attacker-chip")).toHaveText("Not verified");
  await expect(panel.getByTestId("note-field-amount")).toHaveAttribute("data-changed", "true");
  await expect(panel.getByTestId("note-field-amount-value")).toHaveText("100.00 sandbox USD (100,000,000 base units)");
  for (const id of ["prefix", "programId", "clusterId", "mint", "allowanceId", "payeeKeyHash", "currency", "serial", "expiry"]) {
    await expect(panel.getByTestId(`note-field-${id}`), id).toHaveAttribute("data-changed", "false");
  }
  // The receipt's own verdict above is untouched: the edit is a copy.
  await expect(page.getByTestId("receipt-status")).toHaveText("Settled");
  await page.screenshot({ path: testInfo.outputPath("attacker-failed.png"), fullPage: true });

  // Undo.
  const undoStarted = Date.now();
  await panel.getByRole("button", { name: "Undo: restore the signed note" }).click();
  await expect(result).toHaveAttribute("data-outcome", "matches", { timeout: 1000 });
  expect(Date.now() - undoStarted).toBeLessThan(1000);
  await expect(panel.getByTestId("attacker-chip")).toHaveText("Signature matches");
  await expect(amountBox).toHaveValue("1.00");
  await expect(panel.getByTestId("note-field-amount")).toHaveAttribute("data-changed", "false");
  await expect(panel.getByTestId("attacker-changed")).toHaveCount(0);
});

test("picking another labelled merchant fails the signature and names the payee bytes", async ({ page }) => {
  const panel = await openWithTestReceipt(page);
  const positions = payeePositions(merchantB.keyHashHex);
  expect(positions.length).toBeGreaterThan(0);
  expect(positions.every((p) => p >= 89 && p <= 120)).toBe(true);

  await panel
    .getByRole("combobox", { name: "Merchant (payee key hash)" })
    .selectOption({ label: `Test merchant B: ${short(merchantB.keyHashHex)}` });
  await expect(panel.getByTestId("attacker-verdict")).toHaveText(MISMATCH, { timeout: 1000 });
  await expect(panel.getByTestId("attacker-changed")).toHaveText(
    `${positions.length} of 141 bytes changed: ${describePositions(positions)} (merchant key hash).`,
  );
  await expect(panel.getByTestId("note-field-payeeKeyHash")).toHaveAttribute("data-changed", "true");
  await expect(panel.getByTestId("note-field-payeeKeyHash-value")).toHaveText(
    `${short(merchantB.keyHashHex)} (Test merchant B)`,
  );

  await panel.getByRole("button", { name: "Undo: restore the signed note" }).click();
  await expect(panel.getByTestId("attacker-result")).toHaveAttribute("data-outcome", "matches");
});

test("an edit that lands on a note the same payer also signed fails without claiming it was never signed", async ({
  page,
}) => {
  // The vectors file's equivocation pair: its second note is note 0 at 0.50 for test
  // merchant B, signed by the same payer key. The page keeps note 0's signature, so the
  // check must fail, and the words must not say the payer never signed these bytes.
  const second = Buffer.from(vectors.equivocation.secondNoteWireHex, "hex");
  expect(second.subarray(205, 238).toString("hex")).toBe(vectors.keys.payer.publicKeyHex);
  const edited = Buffer.from(signedNote);
  Buffer.from(merchantB.keyHashHex, "hex").copy(edited, PAYEE_AT);
  edited.writeBigUInt64BE(BigInt(500_000), AMOUNT_AT);
  expect(edited.toString("hex")).toBe(second.subarray(0, 141).toString("hex"));
  const positions = differing(signedNote, edited);

  const panel = await openWithTestReceipt(page);
  await panel.getByRole("textbox", { name: "Amount (sandbox USD)" }).fill("0.50");
  await panel
    .getByRole("combobox", { name: "Merchant (payee key hash)" })
    .selectOption({ label: `Test merchant B: ${short(merchantB.keyHashHex)}` });
  await expect(panel.getByTestId("attacker-result")).toHaveAttribute("data-outcome", "signature_mismatch");
  await expect(panel.getByTestId("attacker-verdict")).toHaveText(MISMATCH);
  await expect(panel.getByTestId("attacker-changed")).toHaveText(
    `${positions.length} of 141 bytes changed: ${describePositions(positions)} (merchant key hash and amount).`,
  );
  await expect(panel).not.toContainText("never signed");
});

test("editing and re-checking send nothing: zero requests while the panel works", async ({ page }) => {
  const panel = await openWithTestReceipt(page);
  // Let the page finish loading, including any link prefetch the footer starts when it
  // scrolls into view, before counting.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForLoadState("networkidle");

  const intercepted: string[] = [];
  const seen: string[] = [];
  page.on("request", (req) => seen.push(req.url()));
  await page.route("**/*", async (route) => {
    intercepted.push(route.request().url());
    await route.abort();
  });

  const amountBox = panel.getByRole("textbox", { name: "Amount (sandbox USD)" });
  const merchant = panel.getByRole("combobox", { name: "Merchant (payee key hash)" });
  const undo = panel.getByRole("button", { name: "Undo: restore the signed note" });
  const result = panel.getByTestId("attacker-result");

  await panel.getByRole("button", { name: "Make it 100.00" }).click();
  await expect(result).toHaveAttribute("data-outcome", "signature_mismatch");
  await undo.click();
  await expect(result).toHaveAttribute("data-outcome", "matches");
  await amountBox.fill("2.50");
  await expect(result).toHaveAttribute("data-outcome", "signature_mismatch");
  await merchant.selectOption({ label: `Test merchant B: ${short(merchantB.keyHashHex)}` });
  await expect(panel.getByTestId("attacker-changed")).toContainText("merchant key hash and amount");
  await amountBox.fill("0");
  await expect(result).toHaveAttribute("data-outcome", "not_checked");
  await undo.click();
  await expect(result).toHaveAttribute("data-outcome", "matches");

  expect(intercepted).toEqual([]);
  expect(seen).toEqual([]);

  // The watcher is live: one request made on purpose is caught, so the zero above is a real zero.
  await page.evaluate(() => fetch("/attacker-probe").catch(() => null));
  await expect.poll(() => intercepted.length).toBe(1);
  expect(intercepted[0]).toContain("/attacker-probe");
});

test("an amount the note cannot carry runs no check and says why", async ({ page }) => {
  const panel = await openWithTestReceipt(page);
  const amountBox = panel.getByRole("textbox", { name: "Amount (sandbox USD)" });

  await amountBox.fill("1.2345678");
  await expect(panel.getByTestId("attacker-result")).toHaveAttribute("data-outcome", "not_checked");
  await expect(panel.getByTestId("attacker-result")).toContainText("at most 6 decimals");
  await expect(amountBox).toHaveAttribute("aria-invalid", "true");

  await amountBox.fill("0");
  await expect(panel.getByTestId("attacker-result")).toContainText("must be above 0");

  // One base unit past the u64 maximum, 18446744073709551615 (PAYMENT-V1 section 4.1: amount is u64).
  await amountBox.fill("18446744073709.551616");
  await expect(panel.getByTestId("attacker-result")).toContainText("holds at most 18446744073709.551615 sandbox USD");
});

test("the chain note links the refused cheat transaction the README cites, and says what it is", async ({ page }) => {
  const cited = /\[refused cheat\]\((https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet)\)/.exec(readme);
  expect(cited, "README.md cites a refused cheat transaction").not.toBeNull();
  const panel = await openWithTestReceipt(page);
  await expect(panel.getByTestId("refused-cheat-link")).toHaveAttribute("href", cited![1]);
  await expect(panel.getByTestId("attacker-chain-note")).toContainText("The chain refuses an edited note too");
  await expect(panel.getByTestId("attacker-chain-note")).toContainText("not built yet");
  await expect(panel.getByTestId("attacker-chain-note")).toContainText("a reused serial");
});

test("no panel before a check or under a receipt that fails", async ({ page }) => {
  await page.goto("/verify");
  await expect(page.getByTestId("verify-result")).toContainText("Nothing checked yet.");
  await expect(page.getByTestId("attacker-panel")).toHaveCount(0);

  await page.getByRole("textbox", { name: "Receipt" }).fill(flippedReceipt);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.getByTestId("receipt-status")).toHaveText("Not verified");
  await expect(page.getByTestId("attacker-panel")).toHaveCount(0);
});

test("at 390 px the panel fits with no sideways scroll after an edit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const panel = await openWithTestReceipt(page);
  await panel.getByRole("button", { name: "Make it 100.00" }).click();
  await expect(panel.getByTestId("attacker-verdict")).toHaveText(MISMATCH);
  await panel
    .getByRole("combobox", { name: "Merchant (payee key hash)" })
    .selectOption({ label: `Test merchant B: ${short(merchantB.keyHashHex)}` });
  await expect(panel.getByTestId("attacker-changed")).toContainText("merchant key hash and amount");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await panel.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(390);
  // Stills for review (test-results/ is not committed).
  await panel.screenshot({ path: testInfo.outputPath("attacker-panel-390.png") });
  await page.screenshot({ path: testInfo.outputPath("attacker-390.png"), fullPage: true });
});
