import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import jsQR from "jsqr";
import { base64urlEncode, encodeTransport } from "@lokapay/protocol";
import { FAILING_URL, UPSTREAM } from "./fixtures/ports";
import {
  TEST_EARMARKS,
  TEST_FAILED_TX,
  TEST_SERVER_SEED,
  TEST_TX,
  pendingBody,
  successBody,
  testAllowanceWire,
} from "./fixtures/remittance";

// /send (PLAN.md 3.3). The page's server reads the settlement API's health check from the e2e
// stand-in (e2e/fixtures/upstream.ts: phase3Routes lists POST /v1/remittances as registered),
// and the browser's POST to `${UPSTREAM}/settlement/v1/remittances` is answered HERE by route
// interception, never by a real server. The real API allows only https://zerobars.us, so a
// preview build or localhost could not reach it anyway. Certificates are signed with the
// published test vector key, which the healthy e2e server is told to check against
// (SETTLEMENT_TEST_SERVER_KEY, test mode only). Expected texts are typed out here.

const API = `${UPSTREAM}/settlement/v1/remittances`;
const RECIPIENT = "4242";

async function open(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response, `no response for ${url}`).not.toBeNull();
  expect(response!.status()).toBe(200);
  expect((await response!.allHeaders())["set-cookie"]).toBeUndefined();
}

function watch(page: Page, baseURL: string) {
  const own = new URL(baseURL).origin;
  const seen = { total: 0, foreign: [] as string[] };
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    seen.total += 1;
    if (url.origin !== own) seen.foreign.push(`${req.method()} ${req.url()}`);
  });
  return seen;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  abort?: true;
}

/**
 * Answers the browser's POSTs to the API with `replies` in order (the last one repeats), with
 * the CORS headers the real server sends (server/src/app/app.ts: the request's origin, no
 * exposed headers), and records each POST.
 */
async function mockApi(page: Page, replies: Reply[]) {
  const posts: Request[] = [];
  await page.route(API, async (route: Route) => {
    const req = route.request();
    const origin = (await req.headerValue("origin")) ?? "";
    const cors = {
      "access-control-allow-origin": origin,
      vary: "Origin",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    posts.push(req);
    const reply = replies.length > 1 ? replies.shift()! : replies[0];
    if (reply.abort) return route.abort("connectionrefused");
    return route.fulfill({
      status: reply.status,
      headers: { ...cors, "content-type": "application/json", ...(reply.headers ?? {}) },
      body: JSON.stringify(reply.body ?? {}),
    });
  });
  return posts;
}

async function fill(page: Page, recipient: string, amount: string) {
  await page.getByTestId("send-recipient").fill(recipient);
  await page.getByTestId("send-amount").fill(amount);
  await page.getByTestId("send-submit").click();
}

/** Rebuilds the drawn QR from its SVG path, then decodes it with jsQR, as a scanner would. */
async function scanDrawnQr(page: Page): Promise<string | null> {
  const qr = page.getByTestId("allowance-qr");
  const modules = Number(await qr.getAttribute("data-modules"));
  const d = (await qr.locator("path").getAttribute("d")) ?? "";
  const quiet = 4;
  const scale = 4;
  const side = (modules + 2 * quiet) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const at = ((y * scale + dy) * side + x * scale + dx) * 4;
        data[at] = data[at + 1] = data[at + 2] = 0;
      }
    }
  }
  return jsQR(data, side, side, { inversionAttempts: "dontInvert" })?.data ?? null;
}

for (const width of [390, 1440]) {
  test(`/send at ${width} px: no login, no cookie, nothing loaded from another site, the form on`, async ({ page, context, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    const seen = watch(page, baseURL!);
    await open(page, "/send");
    await expect(page.getByRole("heading", { level: 1, name: "Send sandbox money" })).toBeVisible();
    await expect(page.getByTestId("sandbox-chip").first()).toBeVisible();
    await expect(page.getByTestId("send-on")).toBeVisible();
    await expect(page.getByTestId("send-submit")).toBeEnabled();
    await expect(page.getByTestId("send-server-status")).toHaveText("The settlement server's health check lists POST /v1/remittances as running.");
    await page.waitForLoadState("networkidle");
    expect(seen.total).toBeGreaterThan(2);
    expect(seen.foreign).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await context.cookies()).toEqual([]);
  });
}

test("/judge links to /send", async ({ page }) => {
  await open(page, "/judge");
  const link = page.getByTestId("judge-send-link");
  await expect(link).toHaveAttribute("href", "/send");
});

test("success: one POST with the two contract fields, a Verified certificate, its QR and the explorer link", async ({ page, baseURL }) => {
  const seen = watch(page, baseURL!);
  await open(page, "/send");
  const cert = { allowanceId: BigInt(99), cap: BigInt(750_000), earmarks: TEST_EARMARKS };
  const posts = await mockApi(page, [{ status: 201, body: successBody(RECIPIENT, cert) }]);
  // The phone's prefixed form is accepted and sent as the plain decimal id.
  await fill(page, `LOKA-ALLOWANCE:${RECIPIENT}`, "0.75");

  await expect(page.getByTestId("send-status")).toHaveText("Allowance opened on devnet");
  expect(posts.length).toBe(1);
  expect(posts[0].postData()).toBe(`{"recipientAllowanceId":"${RECIPIENT}","amountUnits":"750000"}`);
  const headers = await posts[0].allHeaders();
  expect(headers["content-type"]).toBe("application/json");
  expect(headers.cookie).toBeUndefined();
  expect(Object.keys(headers).filter((h) => h.startsWith("x-"))).toEqual([]);

  await expect(page.getByTestId("allowance-verdict")).toHaveText("Verified");
  await expect(page.getByText("Checked in this browser against the e2e test key (test mode only, never on the real site).")).toBeVisible();
  await expect(page.getByTestId("cert-allowance-id")).toHaveText("99");
  await expect(page.getByTestId("cert-cap")).toHaveText("0.75 sandbox USDC");
  await expect(page.getByTestId("cert-earmarks")).toHaveText("2 earmarked merchants, set by the server");
  await expect(page.getByTestId("send-explorer")).toHaveAttribute("href", `https://explorer.solana.com/tx/${TEST_TX}?cluster=devnet`);
  await expect(page.getByTestId("send-repeat")).toHaveCount(0);

  const expected = `L1|P|1|A|${base64urlEncode(testAllowanceWire(cert))}`;
  expect(expected).toBe(encodeTransport("A", testAllowanceWire(cert)));
  const qr = page.getByTestId("allowance-qr");
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("data-text", expected);
  expect(await scanDrawnQr(page)).toBe(expected);

  // The only requests to another origin are the POST (and its CORS preflight, where the browser sends one).
  expect(seen.foreign.filter((r) => !r.startsWith(`OPTIONS ${API}`))).toEqual([`POST ${API}`]);
});

test("pending, pending, then success: the same request is sent again after retryAfter, then Verified", async ({ page }) => {
  await open(page, "/send");
  const cert = { allowanceId: BigInt(100), cap: BigInt(1_000_000) };
  const posts = await mockApi(page, [
    { status: 202, body: pendingBody(RECIPIENT, null, 1) },
    { status: 202, body: pendingBody(RECIPIENT, TEST_TX, 1) },
    { status: 201, body: successBody(RECIPIENT, cert) },
  ]);
  await fill(page, RECIPIENT, "1");
  await expect(page.getByTestId("send-progress")).toContainText("Pending: the server has not seen devnet confirm the funding yet.");
  await expect(page.getByTestId("allowance-verdict")).toHaveText("Verified");
  expect(posts.map((p) => p.postData())).toEqual(Array(3).fill(`{"recipientAllowanceId":"${RECIPIENT}","amountUnits":"1000000"}`));
  await expect(page.getByTestId("cert-earmarks")).toHaveText("Any merchant");
});

test("a repeat (200) says the recipient already had a send and shows its first terms", async ({ page }) => {
  await open(page, "/send");
  await mockApi(page, [{ status: 200, body: successBody(RECIPIENT, { allowanceId: BigInt(101), cap: BigInt(250_000) }) }]);
  await fill(page, RECIPIENT, "1.00");
  await expect(page.getByTestId("send-repeat")).toHaveText(
    "This recipient already had a live send. The server returned that send's first terms; nothing new was funded.",
  );
  await expect(page.getByTestId("cert-cap")).toHaveText("0.25 sandbox USDC");
});

const ERRORS: Array<{ name: string; status: number; text: string; retry: boolean; headers?: Record<string, string> }> = [
  { name: "amount_cap", status: 422, text: "The server refused the amount: a send is at most 1.00 sandbox USDC.", retry: false },
  { name: "unknown_allowance", status: 422, text: "No allowance with that id exists on devnet. Check the id on the payer phone and try again.", retry: false },
  {
    name: "budget_exhausted",
    status: 429,
    text: "The server's sandbox send wallet has used its budget for today (days are UTC). Sending works again tomorrow.",
    retry: false,
  },
  { name: "rate_limited", status: 429, text: "Too many sends from this network. Try again later.", retry: false, headers: { "retry-after": "3600" } },
  { name: "chain_unavailable", status: 503, text: "The server could not reach devnet. Nothing was signed, so it is safe to try again.", retry: true },
  { name: "bad_json", status: 400, text: "The server could not read the request.", retry: false },
  { name: "internal_error", status: 500, text: "The server hit an internal error.", retry: true },
];

for (const e of ERRORS) {
  test(`${e.status} ${e.name}: the page says so by the error name, and offers a retry only when it can help`, async ({ page }) => {
    await open(page, "/send");
    await mockApi(page, [{ status: e.status, body: { error: e.name, message: "server text the page never shows" }, headers: e.headers }]);
    await fill(page, RECIPIENT, "0.50");
    await expect(page.getByTestId("send-result")).toHaveAttribute("data-error", e.name);
    await expect(page.getByTestId("send-message")).toHaveText(e.text);
    await expect(page.getByText("server text the page never shows")).toHaveCount(0);
    await expect(page.getByTestId("send-retry")).toHaveCount(e.retry ? 1 : 0);
    await expect(page.getByTestId("allowance-qr")).toHaveCount(0);
  });
}

test("503 chain_unavailable, then Send the same request again: the same body, and it succeeds", async ({ page }) => {
  await open(page, "/send");
  const posts = await mockApi(page, [
    { status: 503, body: { error: "chain_unavailable" } },
    { status: 201, body: successBody(RECIPIENT, { allowanceId: BigInt(102), cap: BigInt(500_000) }) },
  ]);
  await fill(page, RECIPIENT, "0.5");
  await page.getByTestId("send-retry").click();
  await expect(page.getByTestId("allowance-verdict")).toHaveText("Verified");
  expect(posts.map((p) => p.postData())).toEqual(Array(2).fill(`{"recipientAllowanceId":"${RECIPIENT}","amountUnits":"500000"}`));
});

test("409 remittance_failed: Failed on devnet, with the failed transaction's explorer link and no code", async ({ page }) => {
  await open(page, "/send");
  await mockApi(page, [{ status: 409, body: { error: "remittance_failed", signature: TEST_FAILED_TX } }]);
  await fill(page, RECIPIENT, "1");
  await expect(page.getByTestId("send-status")).toHaveText("Failed on devnet");
  await expect(page.getByTestId("send-explorer")).toHaveAttribute("href", `https://explorer.solana.com/tx/${TEST_FAILED_TX}?cluster=devnet`);
  await expect(page.getByTestId("allowance-qr")).toHaveCount(0);
});

test("404 unknown_route: the server does not run the route, so the form turns into the off state", async ({ page }) => {
  await open(page, "/send");
  await mockApi(page, [{ status: 404, body: { error: "unknown_route", message: "Unknown API route." } }]);
  await fill(page, RECIPIENT, "1");
  await expect(page.getByTestId("send-off")).toContainText("Sending is off on the server right now.");
  await expect(page.getByTestId("send-off")).toContainText("404 unknown_route");
  await expect(page.getByTestId("send-submit")).toHaveCount(0);
});

test("a certificate the key did not sign: Not verified, and no code is drawn", async ({ page }) => {
  await open(page, "/send");
  const otherSeed = new Uint8Array(32).fill(7);
  expect(Buffer.from(otherSeed).equals(Buffer.from(TEST_SERVER_SEED))).toBe(false);
  await mockApi(page, [{ status: 201, body: successBody(RECIPIENT, { allowanceId: BigInt(103), cap: BigInt(1_000_000), seed: otherSeed }) }]);
  await fill(page, RECIPIENT, "1");
  await expect(page.getByTestId("send-status")).toHaveText("Allowance opened on devnet");
  await expect(page.getByTestId("allowance-verdict")).toHaveText("Not verified");
  await expect(page.getByTestId("allowance-verdict-reason")).toContainText("its signature does not match the server key");
  await expect(page.getByTestId("allowance-qr")).toHaveCount(0);
});

test("input checks run in the browser: a bad id or an amount over 1.00 sends nothing", async ({ page }) => {
  await open(page, "/send");
  const posts = await mockApi(page, [{ status: 500, body: { error: "internal_error" } }]);
  await fill(page, "loka-allowance:42", "1.01");
  await expect(page.getByTestId("send-recipient-problem")).toHaveText("The code must start with LOKA-ALLOWANCE: in capital letters.");
  await expect(page.getByTestId("send-amount-problem")).toHaveText("A send is at most 1.00 sandbox USDC.");
  await expect(page.getByTestId("send-recipient")).toHaveAttribute("aria-invalid", "true");
  await fill(page, "007", "0.5");
  await expect(page.getByTestId("send-recipient-problem")).toHaveText("An allowance id has no leading zeros.");
  await expect(page.getByTestId("send-amount-problem")).toHaveCount(0);
  expect(posts.length).toBe(0);
});

test("no answer at all (the connection is refused): No answer, with a retry", async ({ page }) => {
  await open(page, "/send");
  await mockApi(page, [{ status: 0, abort: true }]);
  await fill(page, RECIPIENT, "1");
  await expect(page.getByTestId("send-result")).toHaveAttribute("data-kind", "network");
  await expect(page.getByTestId("send-message")).toContainText("could not reach 127.0.0.1:3190");
  await expect(page.getByTestId("send-retry")).toHaveCount(1);
});

test("server off: when this site cannot read the health check, the page says sending is off and has no form", async ({ page }) => {
  await open(page, `${FAILING_URL}/send`);
  await expect(page.getByRole("heading", { level: 1, name: "Send sandbox money" })).toBeVisible();
  await expect(page.getByTestId("send-off")).toContainText("Sending is off on the server right now.");
  await expect(page.getByTestId("send-off")).toContainText("could not read the server's health check");
  await expect(page.getByTestId("send-submit")).toHaveCount(0);
  await expect(page.getByTestId("send-server-status")).toContainText("could not read the server's health check");
});
