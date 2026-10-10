// The e2e servers and the local stand-in they read (TEST FIXTURE ports on 127.0.0.1). Kept
// apart from upstream.ts so playwright.config.ts loads nothing from the app.

import { generateKeyPairSync, randomBytes } from "node:crypto";

/** The stand-in for devnet's JSON-RPC (/rpc) and GitHub's API (/github), e2e/fixtures/upstream.ts. */
export const UPSTREAM_PORT = 3190;
export const UPSTREAM = `http://127.0.0.1:${UPSTREAM_PORT}`;
/** Nothing listens here: the failing e2e server's reads all fail. */
export const CLOSED_PORT = 3191;
/** The e2e server whose reads all fail, for the failure-path tests. */
export const FAILING_PORT = 3101;
export const FAILING_URL = `http://127.0.0.1:${FAILING_PORT}`;
/** Sent by the healthy e2e server as GITHUB_TOKEN; the stand-in records the Authorization it receives. */
export const E2E_GITHUB_TOKEN = "e2e-stand-in-token-not-a-secret";

// ---------- /call (PLAN.md 3.9): TEST FIXTURE settings for the healthy e2e server ----------

/** The Vonage application id the healthy e2e server sends in its JWT. Not a real application. */
export const E2E_VONAGE_APP_ID = "e2e-stand-in-application";
/** The number the e2e calls come from: digits in the fictional 555-01xx range. */
export const E2E_FROM_NUMBER = "12025550100";
/** The ElevenLabs key the healthy e2e server sends to the stand-in; not a secret. */
export const E2E_ELEVENLABS_KEY = "e2e-stand-in-elevenlabs-key-not-a-secret";
/** The desk code the healthy e2e server asks for (LOKA_CALL_CODE); a test value that meets the deployed rule. */
export const E2E_CALL_CODE = "e2eDesk2026";

/**
 * A Vonage-style RSA key and a call secret for this test run, made in memory and never written
 * to disk or committed. They are kept in process.env under names the app never reads, so the
 * Playwright workers (which inherit the runner's environment) see the same key and can check
 * the JWT the server sent; only the healthy e2e server gets them under the app's names.
 */
export function callTestKeys(): { keyB64: string; secret: string } {
  if (!process.env.LOKA_E2E_VONAGE_KEY_B64) {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.LOKA_E2E_VONAGE_KEY_B64 = Buffer.from(privateKey).toString("base64");
  }
  if (!process.env.LOKA_E2E_CALL_SECRET) process.env.LOKA_E2E_CALL_SECRET = randomBytes(32).toString("hex");
  return { keyB64: process.env.LOKA_E2E_VONAGE_KEY_B64, secret: process.env.LOKA_E2E_CALL_SECRET };
}
