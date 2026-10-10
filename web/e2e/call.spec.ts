import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_CALL_CODE, E2E_ELEVENLABS_KEY, E2E_FROM_NUMBER, E2E_VONAGE_APP_ID, FAILING_URL } from "./fixtures/ports";
import { E2E_AUDIO, EXPECTED, UPSTREAM } from "./fixtures/upstream";

// /call (PLAN.md 3.9). The healthy e2e server places its calls through the local stand-in's
// Vonage and ElevenLabs (e2e/fixtures/upstream.ts, wired in playwright.config.ts) and reads the
// recorded devnet history from it; the failing server has every call variable empty, so calls
// are off there. No test reaches a real phone company or voice service. Phone numbers are in
// the fictional 555 range, written as "+" + digits so the repository's phone scrub never
// matches them, and differ per browser project because the server caps calls per number.

const repoRoot = path.resolve(__dirname, "..", "..");
const pins = JSON.parse(readFileSync(path.join(repoRoot, "config", "pins.json"), "utf8"));
const recorded = JSON.parse(readFileSync(path.join(__dirname, "..", "unit", "fixtures", "devnet-transactions.json"), "utf8"));
const PLUS = "+";
const DEVNET = /^https:\/\/api\.devnet\.solana\.com\/?$/;
const DEVNET_WS = /^wss:\/\/api\.devnet\.solana\.com\/?$/;
const CONSENT =
  "It stays in this browser until you press a button. Our server uses it to place one call and never stores or logs it. Vonage, the phone company we use, keeps a record of the call. The voice is made by ElevenLabs from public payment details.";

/** A number for this test in this browser project: 404 555 01xx. */
function numberFor(projectName: string, slot: number): { national: string; digits: string; e164: string } {
  const last = String(40 + slot * 2 + (projectName === "webkit" ? 1 : 0)).padStart(2, "0");
  const national = `40455501${last}`;
  return { national, digits: `1${national}`, e164: `${PLUS}1${national}` };
}

function watchRequests(page: Page, baseURL: string) {
  const own = new URL(baseURL).origin;
  const seen = { total: 0, foreign: [] as Array<{ url: string; body: string }>, own: [] as Array<{ url: string; method: string; body: string }> };
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    seen.total += 1;
    const entry = { url: req.url(), method: req.method(), body: req.postData() ?? "" };
    if (url.origin === own) seen.own.push(entry);
    else seen.foreign.push(entry);
  });
  return seen;
}

async function open(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response, `no response for ${url}`).not.toBeNull();
  expect(response!.status()).toBe(200);
  expect((await response!.allHeaders())["set-cookie"]).toBeUndefined();
}

interface Seen {
  vonage: Array<{ authorization: string; body: { to: Array<{ number: string }>; from: { number: string }; ncco: Array<{ action: string; streamUrl: string[] }>; event_url: string[] } }>;
  speech: Array<{ apiKey: string; voice: string; outputFormat: string | null; body: { text: string; model_id: string } }>;
}

async function standInSeen(page: Page): Promise<Seen> {
  const response = await page.request.get(`${UPSTREAM}/__seen`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Seen;
}

test("/call: loads with no login and no cookies, shows the consent text, and makes no foreign request on load", async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const seen = watchRequests(page, baseURL!);
  await open(page, "/call");
  await expect(page.getByRole("heading", { level: 1, name: "Get a phone call when a payment settles" })).toBeVisible();
  await expect(page.getByTestId("sandbox-chip")).toBeVisible();
  await expect(page.getByTestId("call-consent")).toContainText("Only enter your own number.");
  await expect(page.getByTestId("call-consent")).toContainText(CONSENT);
  await expect(page.getByRole("button", { name: "Call me now about the latest settled payment" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Call me when the next payment settles" })).toBeEnabled();
  await expect(page.getByLabel("Language")).toHaveValue("en");
  // The healthy e2e server asks for a desk code (LOKA_CALL_CODE).
  await expect(page.getByLabel("Desk code (from the LOKA Pay table)")).toBeVisible();
  await expect(page.getByTestId("call-state")).toHaveAttribute("data-state", "idle");
  await page.waitForLoadState("networkidle");
  // Floor: the document plus its CSS and scripts, so "none foreign" is not vacuous.
  expect(seen.total).toBeGreaterThan(2);
  expect(seen.foreign).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("/call: a number outside the US (or toll-free, or premium) is refused on the page and nothing is sent", async ({ page, baseURL }) => {
  const seen = watchRequests(page, baseURL!);
  await open(page, "/call");
  // The UK, Jamaica (a +1 number outside the US), and the 900 premium code.
  for (const typed of [`${PLUS}44 20 7946 0000`, "(876) 555-0100", "1 900 555 0100"]) {
    await page.getByLabel("US phone number").fill(typed);
    await page.getByRole("button", { name: "Call me now about the latest settled payment" }).click();
    await expect(page.getByTestId("number-help")).toHaveText(
      "Enter a US number: 10 digits, with or without +1. Other countries, toll-free and premium numbers cannot be called.",
    );
    await page.getByLabel("US phone number").fill("");
  }
  await expect(page.getByTestId("call-state")).toHaveAttribute("data-state", "idle");
  expect(seen.own.filter((r) => r.url.includes("/api/call"))).toEqual([]);
});

test("/call: Call me now calls through the stand-in, shows Calling and the explorer link; the number goes only to our origin", async ({
  page,
  baseURL,
}, testInfo) => {
  const n = numberFor(testInfo.project.name, 0);
  const seen = watchRequests(page, baseURL!);
  await open(page, "/call");
  await page.getByLabel("US phone number").fill(`(404) 555-01${n.national.slice(-2)}`);
  await page.getByLabel("Desk code (from the LOKA Pay table)").fill(E2E_CALL_CODE);
  await page.getByRole("button", { name: "Call me now about the latest settled payment" }).click();

  const state = page.getByTestId("call-state");
  await expect(state).toHaveAttribute("data-state", "calling");
  await expect(state).toContainText("Calling");
  await expect(page.getByTestId("call-amount")).toContainText(`${EXPECTED.callAmount} sandbox USDC`);
  await expect(page.getByTestId("call-explorer")).toHaveAttribute("href", `https://explorer.solana.com/tx/${EXPECTED.callSignature}?cluster=devnet`);

  // The browser sent the number once, to this site; nothing went anywhere else.
  const posts = seen.own.filter((r) => r.method === "POST" && new URL(r.url).pathname === "/api/call");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0].body)).toEqual({ to: n.e164, lang: "en", code: E2E_CALL_CODE });
  expect(seen.foreign).toEqual([]);
  expect(seen.own.filter((r) => r !== posts[0] && (r.url.includes(n.national) || r.body.includes(n.national)))).toEqual([]);

  // What the server sent the phone company: this number without the plus, our number, and a
  // JWT that verifies with this run's key.
  const all = await standInSeen(page);
  const mine = all.vonage.filter((v) => v.body.to[0]?.number === n.digits);
  expect(mine).toHaveLength(1);
  const call = mine[0];
  expect(call.body.from.number).toBe(E2E_FROM_NUMBER);
  expect(call.body.event_url).toEqual([`${baseURL}/api/call/event`]);
  const keyB64 = process.env.LOKA_E2E_VONAGE_KEY_B64;
  expect(keyB64, "the run's key reaches the worker through the environment").toBeTruthy();
  const publicKey = createPublicKey(createPrivateKey(Buffer.from(keyB64!, "base64").toString("utf8")));
  const [h, c, s] = call.authorization.replace(/^Bearer /, "").split(".");
  expect(verify("sha256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  expect(JSON.parse(Buffer.from(c, "base64url").toString()).application_id).toBe(E2E_VONAGE_APP_ID);

  // The audio link Vonage would fetch: the voice from the ElevenLabs stand-in.
  const streamUrl = call.body.ncco[0].streamUrl[0];
  expect(streamUrl.startsWith(`${baseURL}/api/call/audio?p=`)).toBe(true);
  expect(streamUrl).not.toContain(n.national);
  const audio = await page.request.get(streamUrl);
  expect(audio.status()).toBe(200);
  expect(audio.headers()["content-type"]).toBe("audio/mpeg");
  expect(Buffer.from(await audio.body()).equals(E2E_AUDIO)).toBe(true);
  const speech = (await standInSeen(page)).speech;
  const said = speech.filter((t) => t.body.text.includes("A sandbox payment of 10 cents was settled on Solana devnet"));
  expect(said.length).toBeGreaterThanOrEqual(1);
  expect(said[0].apiKey).toBe(E2E_ELEVENLABS_KEY);
  expect(said[0].body.model_id).toBe("eleven_v4");
  for (const t of speech) expect(JSON.stringify(t)).not.toContain(n.national);

  // Pressing again: one call per number and payment, so the page says so and no call is placed.
  await page.getByRole("button", { name: "Call me now about the latest settled payment" }).click();
  await expect(state).toHaveAttribute("data-state", "rate_limited");
  await expect(state).toContainText("This number already had a call about this payment.");
  await expect(state).not.toContainText("Try again in");
  expect((await standInSeen(page)).vonage.filter((v) => v.body.to[0]?.number === n.digits)).toHaveLength(1);
});

test("/call: armed, a new settlement over the WebSocket posts its signature; the server refuses it as too old", async ({ page, baseURL }, testInfo) => {
  const n = numberFor(testInfo.project.name, 1);
  const redeemSig: string = recorded.redeem.transaction.signatures[0];
  const seen = watchRequests(page, baseURL!);
  // Devnet, as the browser sees it: an empty history, then the recorded redeem over the socket.
  await page.route(DEVNET, async (route: Route) => {
    const body = route.request().postDataJSON();
    const answer = (msg: { id: number; method: string; params: unknown[] }) => {
      if (msg.method === "getSignaturesForAddress") return { jsonrpc: "2.0", id: msg.id, result: [] };
      if (msg.method === "getTransaction") return { jsonrpc: "2.0", id: msg.id, result: msg.params[0] === redeemSig ? recorded.redeem : null };
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not in the test fixture" } };
    };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
  const socketMessages: string[] = [];
  const hooks: { notify?: () => void } = {};
  await page.routeWebSocket(DEVNET_WS, (ws) => {
    ws.onMessage((raw) => {
      socketMessages.push(String(raw));
      const msg = JSON.parse(String(raw));
      if (msg.method === "logsSubscribe") {
        expect(msg.params[0]).toEqual({ mentions: [pins.programId] });
        ws.send(JSON.stringify({ jsonrpc: "2.0", result: 7, id: msg.id }));
        hooks.notify = () =>
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method: "logsNotification",
              params: { subscription: 7, result: { context: { slot: recorded.redeem.slot }, value: { signature: redeemSig, err: null, logs: recorded.redeem.meta.logMessages } } },
            }),
          );
      }
      if (msg.method === "slotSubscribe") ws.send(JSON.stringify({ jsonrpc: "2.0", result: 8, id: msg.id }));
    });
  });

  await open(page, "/call");
  await page.getByLabel("US phone number").fill(n.e164);
  await page.getByLabel("Desk code (from the LOKA Pay table)").fill(E2E_CALL_CODE);
  await page.getByRole("button", { name: "Call me when the next payment settles" }).click();
  const state = page.getByTestId("call-state");
  await expect(state).toHaveAttribute("data-state", "waiting");
  await expect(state).toContainText("live");
  await expect(page.getByRole("button", { name: "Stop waiting" })).toBeVisible();
  // Waiting sends nothing to our server.
  expect(seen.own.filter((r) => new URL(r.url).pathname === "/api/call")).toEqual([]);

  expect(hooks.notify).toBeDefined();
  hooks.notify!();
  await expect(state).toHaveAttribute("data-state", "too_old");
  await expect(state).toContainText("Too old");
  const posts = seen.own.filter((r) => r.method === "POST" && new URL(r.url).pathname === "/api/call");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0].body)).toEqual({ to: n.e164, lang: "en", code: E2E_CALL_CODE, signature: redeemSig });
  // Devnet saw reads and subscriptions, never the number.
  expect(seen.foreign.length).toBeGreaterThan(0);
  for (const r of seen.foreign) expect(`${r.url} ${r.body}`).not.toContain(n.national);
  for (const m of socketMessages) expect(m).not.toContain(n.national);
  // Refused before any call: the phone company never heard of this number.
  expect((await standInSeen(page)).vonage.filter((v) => v.body.to[0]?.number === n.digits)).toEqual([]);
});

test("/call: a missing or wrong desk code is said on the page, and no call is placed", async ({ page, baseURL }, testInfo) => {
  const n = numberFor(testInfo.project.name, 2);
  const seen = watchRequests(page, baseURL!);
  await open(page, "/call");
  await page.getByLabel("US phone number").fill(n.e164);
  // Missing: the page asks for it and sends nothing.
  await page.getByRole("button", { name: "Call me now about the latest settled payment" }).click();
  await expect(page.getByTestId("code-help")).toHaveText("Enter the desk code from the LOKA Pay table.");
  expect(seen.own.filter((r) => new URL(r.url).pathname === "/api/call")).toEqual([]);
  // Wrong: the server refuses it before reading devnet or calling anyone.
  await page.getByLabel("Desk code (from the LOKA Pay table)").fill("not-the-code");
  await page.getByRole("button", { name: "Call me now about the latest settled payment" }).click();
  const state = page.getByTestId("call-state");
  await expect(state).toHaveAttribute("data-state", "wrong_code");
  await expect(state).toContainText("Wrong desk code");
  expect((await standInSeen(page)).vonage.filter((v) => v.body.to[0]?.number === n.digits)).toEqual([]);
});

test("/call: calls off says so and keeps the buttons disabled; the API answers 503 calls_off", async ({ page }) => {
  await open(page, `${FAILING_URL}/call`);
  const state = page.getByTestId("call-state");
  await expect(state).toHaveAttribute("data-state", "off");
  await expect(state).toContainText("Calling is off");
  await expect(page.getByRole("button", { name: "Call me now about the latest settled payment" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Call me when the next payment settles" })).toBeDisabled();
  const response = await page.request.post(`${FAILING_URL}/api/call`, { data: { to: `${PLUS}14045550100`, lang: "en" } });
  expect(response.status()).toBe(503);
  expect((await response.json()).error).toBe("calls_off");
});

test("/live and /judge link to /call", async ({ page }) => {
  await open(page, "/live");
  await expect(page.getByRole("main").getByRole("link", { name: "Get a call on /call" })).toHaveAttribute("href", "/call");
  await open(page, "/judge");
  await expect(page.getByTestId("step-3").getByRole("link", { name: "/call" })).toHaveAttribute("href", "/call");
});
