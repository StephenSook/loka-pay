import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

// The proof pair (PLAN.md 3.74) on /judge and the home page. The iPhone-signed pair leads: a
// settled card and a refused card (SerialUsed 6011), each linking its explorer page. The earlier
// test-key pair sits below it behind a closed disclosure. The signatures are read from
// docs/FACTS.json here, not imported from the app, so a wrong link fails instead of passing by
// construction. They are recorded facts, so no card may say Live.

const facts = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "docs", "FACTS.json"), "utf8")).facts;
const IPHONE_SETTLED: string = facts.proof_pair_iphone_settled_tx.value;
const IPHONE_REFUSED: string = facts.proof_pair_iphone_refused_tx.value;
const IPHONE_SETTLED_NOTE: string = facts.proof_pair_iphone_settled_note_id.value;
const IPHONE_REFUSED_NOTE: string = facts.proof_pair_iphone_refused_note_id.value;
const TEST_KEY_SETTLED: string = facts.proof_pair_settled_tx.value;
const TEST_KEY_REFUSED: string = facts.proof_pair_refused_tx.value;
const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const IPHONE_SETTLED_LABEL = "Signed on an iPhone (Secure Enclave key), paid offline by camera QR, Sat Oct 10 4:23 PM ET";
const IPHONE_REFUSED_LABEL =
  "Same allowance and serial signed again on that iPhone, refused by Solana: SerialUsed (6011), Sat Oct 10 4:31 PM ET";
const TEST_KEY_LABEL = "Signed outside the iPhone app with a test key, Sat Oct 10 2:01 AM ET.";

/** One settled card and one refused card in `group`, each with its signature, link, word, icon and label. */
async function checkCards(
  group: Locator,
  want: { settled: string; refused: string; settledLabel: string; refusedLabel: string },
) {
  await expect(group.getByTestId("proof-settled")).toHaveCount(1);
  await expect(group.getByTestId("proof-refused")).toHaveCount(1);
  await expect(group.getByTestId("proof-explorer")).toHaveCount(2);

  const settled = group.getByTestId("proof-settled");
  await expect(settled).toHaveAttribute("data-signature", want.settled);
  await expect(settled.getByTestId("proof-explorer")).toHaveAttribute("href", explorer(want.settled));
  await expect(settled.getByTestId("proof-explorer")).toHaveAttribute("target", "_blank");
  await expect(settled.getByTestId("proof-status")).toHaveText("Settled");
  await expect(settled.getByTestId("proof-label")).toHaveText(want.settledLabel);
  // A state is a word and an icon.
  await expect(settled.getByTestId("proof-status").locator("svg")).toHaveCount(1);

  const refused = group.getByTestId("proof-refused");
  await expect(refused).toHaveAttribute("data-signature", want.refused);
  await expect(refused.getByTestId("proof-explorer")).toHaveAttribute("href", explorer(want.refused));
  await expect(refused.getByTestId("proof-explorer")).toHaveAttribute("target", "_blank");
  await expect(refused.getByTestId("proof-status")).toHaveText("Failed: SerialUsed (6011)");
  await expect(refused.getByTestId("proof-label")).toHaveText(want.refusedLabel);
  await expect(refused.getByTestId("proof-status").locator("svg")).toHaveCount(1);
  await expect(refused).toHaveClass(/border-failed-strong/);

  // Recorded facts, not current reads: no card says Live, and no card is a /proof claim.
  for (const card of [settled, refused]) {
    await expect(card).not.toContainText(/\blive\b/i);
    await expect(card.locator('[data-testid="claim-status"]')).toHaveCount(0);
  }
}

async function checkPair(page: Page) {
  const pair = page.getByTestId("proof-pair");
  await expect(pair).toBeVisible();
  await expect(pair.getByRole("heading", { level: 2 })).toHaveText("Settled, then refused");
  // Two pairs in all: the iPhone pair and the test-key pair, four explorer links.
  await expect(pair.getByTestId("proof-settled")).toHaveCount(2);
  await expect(pair.getByTestId("proof-refused")).toHaveCount(2);
  await expect(pair.getByTestId("proof-explorer")).toHaveCount(4);

  // The iPhone pair leads: it is visible, and its settled card is the first card in the section.
  const iphone = pair.getByTestId("proof-pair-iphone");
  await expect(iphone).toBeVisible();
  await expect(pair.getByTestId("proof-settled").first()).toHaveAttribute("data-signature", IPHONE_SETTLED);
  await expect(pair.getByTestId("proof-explorer").first()).toHaveAttribute("href", explorer(IPHONE_SETTLED));
  await checkCards(iphone, {
    settled: IPHONE_SETTLED,
    refused: IPHONE_REFUSED,
    settledLabel: IPHONE_SETTLED_LABEL,
    refusedLabel: IPHONE_REFUSED_LABEL,
  });
  await expect(iphone.getByTestId("proof-settled").getByTestId("proof-note-id")).toHaveAttribute("data-note-id", IPHONE_SETTLED_NOTE);
  await expect(iphone.getByTestId("proof-refused").getByTestId("proof-note-id")).toHaveAttribute("data-note-id", IPHONE_REFUSED_NOTE);

  // The test-key pair comes after it, behind a disclosure that starts closed.
  const testKey = pair.getByTestId("proof-pair-test-key");
  const after = await page.evaluate(() => {
    const first = document.querySelector('[data-testid="proof-pair-iphone"]');
    const second = document.querySelector('[data-testid="proof-pair-test-key"]');
    return Boolean(first && second && first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(after).toBe(true);
  await expect(testKey).not.toHaveAttribute("open");
  await expect(testKey.getByTestId("proof-settled")).toBeHidden();
  await testKey.locator("summary").click();
  await expect(testKey.getByTestId("proof-settled")).toBeVisible();
  await expect(testKey.getByTestId("proof-refused")).toBeVisible();
  await checkCards(testKey, {
    settled: TEST_KEY_SETTLED,
    refused: TEST_KEY_REFUSED,
    settledLabel: TEST_KEY_LABEL,
    refusedLabel: TEST_KEY_LABEL,
  });
  await expect(testKey.getByTestId("proof-note-id")).toHaveCount(0);

  // No request leaves the site for the pair: the links are links, never images or embeds.
  await expect(pair.locator("img, iframe")).toHaveCount(0);
}

test("/judge: the proof pair sits above the itinerary, leads with the iPhone pair and links the FACTS signatures", async ({ page }) => {
  const response = await page.goto("/judge");
  expect(response?.status()).toBe(200);
  await checkPair(page);
  // Above the itinerary list, in document order.
  const above = await page.evaluate(() => {
    const pair = document.querySelector('[data-testid="proof-pair"]');
    const itinerary = document.querySelector('ol[aria-label="Itinerary"]');
    return Boolean(pair && itinerary && pair.compareDocumentPosition(itinerary) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(above).toBe(true);
});

test("home: the proof pair leads with the iPhone pair and leaves one link each to /live, /verify, /proof and /trust", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await checkPair(page);
  const main = page.getByRole("main");
  for (const href of ["/live", "/verify", "/proof", "/trust"]) {
    await expect(main.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
});

for (const width of [360, 390]) {
  test(`the proof pair causes no sideways scroll at ${width} px, with the test-key pair closed or open`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const pagePath of ["/", "/judge"]) {
      await page.goto(pagePath);
      await expect(page.getByTestId("proof-pair")).toBeVisible();
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(await overflow(), `${pagePath} closed`).toBeLessThanOrEqual(0);
      await page.getByTestId("proof-pair-test-key").locator("summary").click();
      await expect(page.getByTestId("proof-pair-test-key").getByTestId("proof-settled")).toBeVisible();
      expect(await overflow(), `${pagePath} open`).toBeLessThanOrEqual(0);
    }
  });
}
