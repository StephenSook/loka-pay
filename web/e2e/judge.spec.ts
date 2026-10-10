import { expect, test, type Page } from "@playwright/test";

// The no-login judge path: every page here must load for a stranger with no
// account, set no cookie, and make no request to another origin.

// Typed out here on purpose, not imported from the app, so a copy change shows up
// as a failing test instead of passing by construction.
// Payments so far went by camera QR, so the sentence says QR code; Bluetooth is said beside it
// as built and not yet shown.
const SENTENCE =
  "When the network or the bank goes down, LOKA Pay lets a phone in airplane mode pay a shop's phone directly, in one hop by QR code, and the shop's phone settles the payment on Solana devnet when it finds signal.";
const BLUETOOTH_STATUS = "Bluetooth delivery is built but has not carried a payment yet.";
const STATUS =
  "Built this weekend at Hacklanta II. Real iPhone payments settled on Solana devnet at 4:23 PM and 5:05 PM ET on Sat Oct 10. Each time, the same serial signed again was refused on chain, at 4:31 PM and 5:09 PM ET.";
// The status card's four links, in order: the two iPhone runs, each settled then refused.
const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const STATUS_LINKS = [
  ["Payment settled, 4:23 PM", explorerTx("2SpG1YURVivMHY3VNWwRsDfo7SZBjWZHXZHeqAovEh6RTNE4XVVNrH5BzU84yJk6nXyqprdHAxt22QSuktskez17")],
  ["Cheat refused, 4:31 PM", explorerTx("3XtQtnHRKC3QvhBGye8gTMWimPg3iPXuBskf3LMsQEhJPdzeGiqEEjrmjFLqXFTJMQ9JFAitWoCbuEGFSLKjZc9n")],
  ["Payment settled, 5:05 PM", explorerTx("5bwtrE78DKhuQiANbY6e3ZceitYqtx85buWnVpPP14y5uLTQGLkWdntGKs3f7itYBMCW1Uqsb3ZoqWGpmGu6fF3T")],
  ["Cheat refused, 5:09 PM", explorerTx("3uBwo59QKFcXXkGJZRPZw8X8hk6x2Yr2wr69cFDuu6c45wd38N76jBoshsEgbc2SKzAHWssUmfpSf9ACgnnUT6HK")],
] as const;

/** Records every request the page makes and which of them left our origin. */
function watchRequests(page: Page, baseURL: string) {
  const own = new URL(baseURL).origin;
  const seen = { total: 0, foreign: [] as string[] };
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    seen.total += 1;
    if (url.origin !== own) seen.foreign.push(req.url());
  });
  return seen;
}

async function openWithNoCookies(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response, `no response for ${path}`).not.toBeNull();
  expect(response!.status()).toBe(200);
  const headers = await response!.allHeaders();
  expect(headers["set-cookie"]).toBeUndefined();
  return response!;
}

async function expectNoForeignRequests(page: Page, seen: { total: number; foreign: string[] }) {
  await page.waitForLoadState("networkidle");
  // Floor: the document plus its CSS and scripts. A count of zero would mean the
  // watcher saw nothing, and "no foreign requests" would then prove nothing.
  expect(seen.total).toBeGreaterThan(2);
  expect(seen.foreign).toEqual([]);
}

test("home: loads with no login, shows the sentence and the sandbox chip", async ({
  page,
  context,
  baseURL,
}) => {
  const seen = watchRequests(page, baseURL!);
  await openWithNoCookies(page, "/");

  await expect(page.getByText(SENTENCE, { exact: true })).toBeVisible();
  await expect(page.getByTestId("bluetooth-status")).toHaveText(BLUETOOTH_STATUS);
  // The page description carries the same sentence, so a search result says QR code too.
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", SENTENCE);
  await expect(page.getByRole("main")).not.toContainText("over Bluetooth or a QR code");
  await expect(page.getByTestId("sandbox-chip")).toBeVisible();
  await expect(page.getByTestId("sandbox-chip")).toHaveText("Sandbox");
  await expect(page.getByTestId("home-status-text")).toHaveText(STATUS);
  await expect(page.getByTestId("home-status")).not.toContainText("being built");
  const statusLinks = page.getByTestId("home-status-tx");
  await expect(statusLinks).toHaveCount(STATUS_LINKS.length);
  for (const [i, [name, href]] of STATUS_LINKS.entries()) {
    await expect(statusLinks.nth(i)).toContainText(name);
    await expect(statusLinks.nth(i)).toHaveAttribute("href", href);
    await expect(statusLinks.nth(i)).toHaveAttribute("target", "_blank");
  }
  await expect(page.getByRole("link", { name: "Read the code on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/StephenSook/loka-pay",
  );
  await expect(page.getByRole("main").getByRole("link", { name: /privacy/i })).toHaveAttribute(
    "href",
    "/privacy",
  );

  await expectNoForeignRequests(page, seen);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
});

test("privacy: loads with no login and says what is true today", async ({
  page,
  context,
  baseURL,
}) => {
  const seen = watchRequests(page, baseURL!);
  await openWithNoCookies(page, "/privacy");

  const main = page.getByRole("main");
  await expect(main).toContainText("No sign-up");
  await expect(main).toContainText("Updated 2026-10-10");
  await expect(main).toContainText("Two pages make your browser contact another website");
  await expect(main).toContainText("/call connects to the same server to watch for the next settled payment, only after you press");
  await expect(main).toContainText("keeps a keyed hash of the number (not the number) for up to 24 hours");
  await expect(main).toContainText("Your number is never sent to ElevenLabs.");
  await expect(main).toContainText("keeps a keyed hash of your network address (not the address, and made with a random key");
  await expect(main).toContainText("sets no cookies and runs no analytics or tracking");
  await expect(main).toContainText("The settlement server at api.zerobars.us is running on Solana devnet.");
  await expect(main).not.toContainText("not live");
  // The server is merged: the table follows its code, and nothing says it is still under review.
  await expect(main).not.toContainText(/in\s+review/i);
  await expect(main).toContainText(
    "All but the last two rows of the table below are what it stores, read from its code (server/ in the repository); the last two are what the /call page handles.",
  );
  await expect(main).toContainText("The /proof and /send pages read its public health check (api.zerobars.us/api/health) from our web server");
  await expect(main).toContainText("/send makes your browser contact our settlement server at api.zerobars.us only after you press its Send button");
  const addressRow = main.getByRole("row", { name: /A keyed hash of your network address/ });
  await expect(addressRow).toContainText("never written to its database or logs");
  await expect(page.getByRole("heading", { name: "What we store" })).toBeVisible();
  await expect(main.getByRole("table")).toContainText("A merchant's display name, typed by the merchant");
  const numberRow = main.getByRole("row", { name: /Your phone number, if you ask for a call on \/call/ });
  await expect(numberRow).toContainText("Stored nowhere. Our server passes it once to Vonage to place one call");
  const wordsRow = main.getByRole("row", { name: /The words the call says/ });
  await expect(wordsRow).toContainText("Sent to ElevenLabs to make the voice: public payment details only");
  await expect(page.getByRole("link", { name: "team@zerobars.us" })).toHaveAttribute(
    "href",
    "mailto:team@zerobars.us",
  );

  await expectNoForeignRequests(page, seen);
  expect(await context.cookies()).toEqual([]);
});

for (const path of ["/", "/privacy"]) {
  test(`${path}: no sideways scroll at phone width`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openWithNoCookies(page, path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("dark mode uses the warm night background, never pure black", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openWithNoCookies(page, "/");
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(20, 22, 58)");
});
