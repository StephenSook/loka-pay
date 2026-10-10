import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { decodeAllowance, formatUnits } from "../lib/vault";

// /watch (PLAN.md 3.85): a judge's own phone reads one allowance straight from devnet. Devnet's
// JSON-RPC is intercepted here and answered with real answers recorded for the demo payer's
// allowance (unit/fixtures/devnet-watch.json, its _about says how), so the page's parsing is
// checked against what devnet actually sent. The getAccountInfo and getSignaturesForAddress
// handlers answer only for the allowance's real address, so the page must work that address out
// itself from the id. The meter is compared with decodeAllowance on the recorded account bytes;
// the signatures, the explorer links and the error name are written out here.

const recorded = JSON.parse(readFileSync(path.join(__dirname, "..", "unit", "fixtures", "devnet-watch.json"), "utf8"));
const ID: string = recorded.allowanceId;
const ADDRESS: string = recorded.address;
const DEVNET = /^https:\/\/api\.devnet\.solana\.com\/?$/;
const SETTLED_IPHONE = "2SpG1YURVivMHY3VNWwRsDfo7SZBjWZHXZHeqAovEh6RTNE4XVVNrH5BzU84yJk6nXyqprdHAxt22QSuktskez17";
const REFUSED_IPHONE = "3XtQtnHRKC3QvhBGye8gTMWimPg3iPXuBskf3LMsQEhJPdzeGiqEEjrmjFLqXFTJMQ9JFAitWoCbuEGFSLKjZc9n";
const OPEN = "3oBQgH9tJGbL9Tvzi4FWmec2Yq8sgeumCXxWQpaLw6RgrgN1baG8xLVCGT4AqNnPstwLLiEC51r2RXEvFFS31YQq";
const ALL: string[] = recorded.getSignaturesForAddress.result.map((s: { signature: string }) => s.signature);
const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const row = (page: Page, signature: string) => page.locator(`[data-testid="watch-row"][data-signature="${signature}"]`);

interface Devnet {
  /** Signatures devnet lists for the allowance, newest first. */
  list: string[];
  /** Answer every request with this HTTP status instead. */
  status?: number;
  calls: Record<string, number>;
  requests: number;
}

async function routeDevnet(page: Page, list: string[], status?: number): Promise<Devnet> {
  const devnet: Devnet = { list, status, calls: {}, requests: 0 };
  await page.route(DEVNET, async (route: Route) => {
    devnet.requests += 1;
    if (devnet.status) {
      await route.fulfill({ status: devnet.status, body: "unavailable (test fixture)" });
      return;
    }
    const body = route.request().postDataJSON();
    const answer = (msg: { id: number; method: string; params: unknown[] }) => {
      devnet.calls[msg.method] = (devnet.calls[msg.method] ?? 0) + 1;
      const forAllowance = msg.params[0] === ADDRESS;
      if (msg.method === "getAccountInfo" && forAllowance) return { jsonrpc: "2.0", id: msg.id, result: recorded.getAccountInfo.result };
      if (msg.method === "getSignaturesForAddress" && forAllowance) {
        const all = recorded.getSignaturesForAddress.result as Array<{ signature: string }>;
        return { jsonrpc: "2.0", id: msg.id, result: devnet.list.map((s) => all.find((x) => x.signature === s)) };
      }
      if (msg.method === "getTransaction") {
        const tx = recorded.getTransaction[msg.params[0] as string];
        return { jsonrpc: "2.0", id: msg.id, result: tx ? tx.result : null };
      }
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "not in the test fixture (wrong address?)" } };
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
  return devnet;
}

/** Requests to anywhere but this site and devnet, and any request to this site's own API. */
function watchRequests(page: Page, baseURL: string) {
  const own = new URL(baseURL).origin;
  const bad: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin === own ? url.pathname.startsWith("/api/") : url.host !== "api.devnet.solana.com") bad.push(req.url());
  });
  return bad;
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("/watch: the meter equals the recorded allowance; the iPhone payment is Paid and the iPhone cheat Refused, each with its explorer link", async ({
  page,
  baseURL,
}) => {
  const bad = watchRequests(page, baseURL!);
  await routeDevnet(page, ALL);
  const response = await page.goto(`/watch?a=${ID}`);
  expect(response!.status()).toBe(200);
  await expect(page.getByTestId("sandbox-chip")).toBeVisible();

  const decoded = decodeAllowance(Buffer.from(recorded.getAccountInfo.result.value.data[0], "base64"));
  const meter = page.getByTestId("meter");
  await expect(meter).toHaveAttribute("data-state", "ok");
  await expect(meter.getByTestId("meter-id")).toHaveText(ID);
  await expect(meter.getByTestId("meter-cap")).toHaveText(formatUnits(decoded.cap));
  await expect(meter.getByTestId("meter-settled")).toHaveText(formatUnits(decoded.redeemed));
  await expect(meter.getByTestId("meter-left")).toHaveText(formatUnits(decoded.cap - decoded.redeemed));
  await expect(meter.getByTestId("meter-serials")).toHaveText(`${decoded.usedSerialCount} of 256`);
  await expect(meter.getByTestId("meter-offline")).toHaveText(formatUnits(decoded.offlineLimit));
  await expect(meter.getByTestId("meter-read")).toContainText(`slot ${recorded.getAccountInfo.result.context.slot}`);
  await expect(meter.getByTestId("meter-account")).toHaveAttribute("href", `https://explorer.solana.com/address/${ADDRESS}?cluster=devnet`);

  const paid = row(page, SETTLED_IPHONE);
  await expect(paid).toHaveAttribute("data-kind", "paid");
  await expect(paid.getByTestId("watch-status")).toHaveText("Paid");
  await expect(paid.getByTestId("watch-status").locator("svg")).toHaveCount(1);
  await expect(paid.getByTestId("watch-headline")).toHaveText("Paid 0.25 sandbox USDC");
  await expect(paid.getByTestId("watch-serial")).toHaveText("Serial 0");
  await expect(paid.getByTestId("watch-explorer")).toHaveAttribute("href", explorer(SETTLED_IPHONE));
  await expect(paid).toContainText("network fee 10,000 lamports");

  const refused = row(page, REFUSED_IPHONE);
  await expect(refused).toHaveAttribute("data-kind", "refused");
  await expect(refused.getByTestId("watch-status")).toHaveText("Refused");
  await expect(refused.getByTestId("watch-headline")).toHaveText("Refused: SerialUsed (6011)");
  await expect(refused.getByTestId("watch-reason")).toHaveText("This allowance serial was already redeemed. No money moved.");
  await expect(refused.getByTestId("watch-explorer")).toHaveAttribute("href", explorer(REFUSED_IPHONE));
  await expect(refused).not.toContainText("InstructionError");

  // Four redeem_note rows, newest first; the open_allowance is not a payment.
  await expect(page.getByTestId("watch-row")).toHaveCount(4);
  await expect(page.getByTestId("watch-row").first()).toHaveAttribute("data-signature", ALL[0]);
  await expect(row(page, OPEN)).toHaveCount(0);
  await expect(page.getByTestId("watch-list-state")).toContainText("Latest 5 transactions on this allowance read at");
  await expect(page.getByTestId("watch-list-state")).toContainText("One is not a payment (such as the transaction that opened the allowance), so not listed.");
  await expect(page.getByTestId("watch-polling")).toHaveAttribute("data-state", "running");
  expect(bad).toEqual([]);
});

test("/watch: the cheat landing while the page is open appears within one read, marked New", async ({ page }) => {
  // TEST FIXTURE timing: devnet first lists the allowance as it stood after the 4:23 PM payment.
  const devnet = await routeDevnet(page, [SETTLED_IPHONE, OPEN]);
  await page.goto(`/watch?a=${ID}`);
  await expect(row(page, SETTLED_IPHONE)).toHaveAttribute("data-kind", "paid");
  await expect(page.getByTestId("watch-row")).toHaveCount(1);
  await expect(row(page, SETTLED_IPHONE).getByTestId("watch-new")).toHaveCount(0);

  devnet.list = [REFUSED_IPHONE, SETTLED_IPHONE, OPEN];
  const cheat = row(page, REFUSED_IPHONE);
  await expect(cheat.getByTestId("watch-headline")).toHaveText("Refused: SerialUsed (6011)", { timeout: 10_000 });
  await expect(cheat.getByTestId("watch-new")).toHaveText("New");
  await expect(page.getByTestId("watch-row").first()).toHaveAttribute("data-signature", REFUSED_IPHONE);
});

test("/watch: a hidden page stops reading devnet, and reads again when shown", async ({ page }) => {
  const devnet = await routeDevnet(page, ALL);
  await page.goto(`/watch?a=${ID}`);
  await expect(page.getByTestId("watch-polling")).toHaveAttribute("data-state", "running");
  await setHidden(page, true);
  await expect(page.getByTestId("watch-polling")).toHaveAttribute("data-state", "paused");
  const before = devnet.requests;
  // Longer than one read interval (lib/watch.ts POLL_MS, 5 s).
  await page.waitForTimeout(6500);
  expect(devnet.requests).toBe(before);
  await setHidden(page, false);
  await expect.poll(() => devnet.requests, { timeout: 3000 }).toBeGreaterThan(before);
  await expect(page.getByTestId("watch-polling")).toHaveAttribute("data-state", "running");
});

test("/watch: a failed devnet read is said plainly, never filled in", async ({ page }) => {
  await routeDevnet(page, ALL, 503);
  await page.goto(`/watch?a=${ID}`);
  await expect(page.getByTestId("watch-list-state")).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("watch-list-state")).toContainText("answered HTTP 503");
  await expect(page.getByTestId("meter")).toHaveAttribute("data-state", "failed");
  await expect(page.getByTestId("meter-failed")).toContainText("answered HTTP 503");
  await expect(page.getByTestId("meter-cap")).toHaveCount(0);
  await expect(page.getByTestId("watch-row")).toHaveCount(0);
});

test("/watch without an id, or with a malformed one, asks for it and reads nothing", async ({ page }) => {
  const devnet = await routeDevnet(page, ALL);
  await page.goto("/watch");
  await expect(page.getByTestId("watch-choose")).toBeVisible();
  await expect(page.getByTestId("watch-id-problem")).toHaveCount(0);
  await expect(page.getByTestId("watch-demo-link")).toHaveAttribute("href", `/watch?a=${ID}`);
  await page.goto("/watch?a=12ab");
  await expect(page.getByTestId("watch-id-problem")).toHaveText("An allowance id is the digits 0 to 9 only, with no spaces or separators.");
  await page.goto("/watch?a=018446744073709551615");
  await expect(page.getByTestId("watch-id-problem")).toHaveText("An allowance id has no leading zeros.");
  expect(devnet.requests).toBe(0);
  // The payer phone's own code works too.
  await page.goto(`/watch?a=LOKA-ALLOWANCE:${ID}`);
  await expect(page.getByTestId("meter-id")).toHaveText(ID);
});

test("/judge: the Watch on your phone QR opens /watch for the demo allowance on zerobars.us", async ({ page }) => {
  await page.goto("/judge");
  const block = page.getByTestId("watch-on-phone");
  await expect(block.getByRole("heading", { name: "Watch on your phone" })).toBeVisible();
  await expect(block.getByTestId("watch-qr")).toHaveAttribute("data-text", `https://zerobars.us/watch?a=${ID}`);
  await expect(block.getByTestId("watch-link")).toHaveAttribute("href", `/watch?a=${ID}`);
});

for (const url of [`/watch?a=${ID}`, "/judge"]) {
  test(`${url} at 390 px: no horizontal scroll`, async ({ page }) => {
    await routeDevnet(page, ALL);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    if (url.startsWith("/watch")) await expect(row(page, REFUSED_IPHONE)).toHaveAttribute("data-kind", "refused");
    else await expect(page.getByTestId("watch-qr")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBe(0);
  });
}
