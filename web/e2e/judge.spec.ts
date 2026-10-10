import { expect, test, type Page } from "@playwright/test";

// The no-login judge path: every page here must load for a stranger with no
// account, set no cookie, and make no request to another origin.

// Typed out here on purpose, not imported from the app, so a copy change shows up
// as a failing test instead of passing by construction.
const SENTENCE =
  "When the network or the bank goes down, LOKA Pay lets phones in airplane mode pay each other over Bluetooth, and the shop's phone settles on Solana's public test network the moment it finds signal.";
const STATUS = "Built this weekend at Hacklanta II. The payment loop is being built now.";

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
  await expect(page.getByTestId("sandbox-chip")).toBeVisible();
  await expect(page.getByTestId("sandbox-chip")).toHaveText("Sandbox");
  await expect(page.getByText(STATUS, { exact: true })).toBeVisible();
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
  await expect(main).toContainText("One page makes your browser contact another website");
  await expect(main).toContainText("sets no cookies and runs no analytics or tracking");
  await expect(main).toContainText("The settlement server at api.zerobars.us is running on Solana devnet.");
  await expect(main).not.toContainText("not live");
  await expect(page.getByRole("heading", { name: "What we store" })).toBeVisible();
  await expect(main.getByRole("table")).toContainText("A merchant's display name, typed by the merchant");
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
