import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The proof pair (PLAN.md 3.74) on /judge and the home page: a settled card and a refused card
// (SerialUsed 6011), each linking its explorer page. The signatures are read from
// docs/FACTS.json here, not imported from the app, so a wrong link fails instead of passing by
// construction. They are recorded facts, so no card may say Live.

const facts = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "docs", "FACTS.json"), "utf8")).facts;
const SETTLED: string = facts.proof_pair_settled_tx.value;
const REFUSED: string = facts.proof_pair_refused_tx.value;
const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const LABEL = "Signed outside the iPhone app with a test key, Sat Oct 10 2:01 AM ET.";

async function checkPair(page: Page) {
  const pair = page.getByTestId("proof-pair");
  await expect(pair).toBeVisible();
  await expect(pair.getByRole("heading", { level: 2 })).toHaveText("Settled, then refused");
  // Exactly two cards, each with one explorer link.
  await expect(pair.getByRole("listitem")).toHaveCount(2);
  await expect(pair.getByTestId("proof-explorer")).toHaveCount(2);

  const settled = pair.getByTestId("proof-settled");
  await expect(settled).toHaveAttribute("data-signature", SETTLED);
  await expect(settled.getByTestId("proof-explorer")).toHaveAttribute("href", explorer(SETTLED));
  await expect(settled.getByTestId("proof-explorer")).toHaveAttribute("target", "_blank");
  await expect(settled.getByTestId("proof-status")).toHaveText("Settled");
  await expect(settled.getByTestId("proof-label")).toHaveText(LABEL);
  // A state is a word and an icon.
  await expect(settled.getByTestId("proof-status").locator("svg")).toHaveCount(1);

  const refused = pair.getByTestId("proof-refused");
  await expect(refused).toHaveAttribute("data-signature", REFUSED);
  await expect(refused.getByTestId("proof-explorer")).toHaveAttribute("href", explorer(REFUSED));
  await expect(refused.getByTestId("proof-status")).toHaveText("Failed: SerialUsed (6011)");
  await expect(refused.getByTestId("proof-label")).toHaveText(LABEL);
  await expect(refused.getByTestId("proof-status").locator("svg")).toHaveCount(1);
  await expect(refused).toHaveClass(/border-failed-strong/);

  // Recorded facts, not current reads: no card says Live, and no card is a /proof claim.
  for (const card of [settled, refused]) {
    await expect(card).not.toContainText(/\blive\b/i);
    await expect(card.locator('[data-testid="claim-status"]')).toHaveCount(0);
  }
  // No request leaves the site for the pair: the links are links, never images or embeds.
  await expect(pair.locator("img, iframe")).toHaveCount(0);
}

test("/judge: the proof pair sits above the itinerary and links the FACTS signatures", async ({ page }) => {
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

test("home: the proof pair links the FACTS signatures and leaves one link each to /live, /verify, /proof and /trust", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await checkPair(page);
  const main = page.getByRole("main");
  for (const href of ["/live", "/verify", "/proof", "/trust"]) {
    await expect(main.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
});

for (const width of [360, 390]) {
  test(`the proof pair causes no sideways scroll at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const pagePath of ["/", "/judge"]) {
      await page.goto(pagePath);
      await expect(page.getByTestId("proof-pair")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, pagePath).toBeLessThanOrEqual(0);
    }
  });
}
