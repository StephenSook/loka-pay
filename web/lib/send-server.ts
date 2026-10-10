// What /send's server component hands the browser besides the form (app/send/page.tsx).
// Server only: it reads the environment.
//
// - The API base the browser posts to: always https://api.zerobars.us, unless the e2e test mode
//   names a local stand-in (lib/settlement.ts settlementApiBase).
// - The key the browser checks a returned allowance certificate against: the pinned
//   serverEd25519PublicKey from config/pins.json (lib/deployment.ts). SETTLEMENT_TEST_SERVER_KEY
//   may replace it only in the e2e test mode and never in a deployed production build, so the
//   e2e tests can sign certificates with a key made for the test run; the page then says so.
// - Whether sending is on: only while the server's health check (read on our server, cached,
//   lib/settlement.ts) says it reaches devnet AND lists POST /v1/remittances as registered.

import { toHex } from "@lokapay/protocol";
import { pinnedDeployment } from "./deployment";
import type { Read } from "./read-state";
import type { SerializedDeployment } from "./receipt";
import { describeFailure } from "./solana";
import { settlementApiBase, type ServerHealth } from "./settlement";
import { assertTestUpstream } from "./test-upstream";

/** On, or off with the reason the page shows. */
export type SendAvailability = { on: true; reason: null } | { on: false; reason: string };

/**
 * Off unless the latest health read succeeded, the server reaches devnet, and its answer lists
 * POST /v1/remittances as registered. A health answer with no phase3Routes entry (a server
 * deployed before the Phase 3 routes) is off, never assumed on.
 */
export function sendAvailability(health: Read<ServerHealth>, api: { ok: true; base: string } | { ok: false; reason: string }): SendAvailability {
  if (!api.ok) return { on: false, reason: api.reason };
  if (!health.ok) return { on: false, reason: `This site could not read the server's health check: ${health.reason}.` };
  if (health.staleBecause) {
    return { on: false, reason: `The latest read of the server's health check failed: ${health.staleBecause.reason}.` };
  }
  if (!health.data.ok) return { on: false, reason: "The server's health check says it cannot reach devnet right now." };
  const route = health.data.remittances;
  if (route === null) {
    return { on: false, reason: "The server's health check does not list POST /v1/remittances, so that route is not deployed yet." };
  }
  if (!route.registered) return { on: false, reason: `The server's health check lists POST /v1/remittances as not running (${route.reason}).` };
  return { on: true, reason: null };
}

export type KeySource = "pinned" | "e2e_test";

export type SendVerifier =
  | { ok: true; deployment: SerializedDeployment; keySource: KeySource }
  | { ok: false; reason: string };

/** The deployment and server key the browser checks certificates against, or why there is none. */
export function sendVerifier(): SendVerifier {
  if (!pinnedDeployment) {
    return { ok: false, reason: "config/pins.json has no server key yet, so a certificate cannot be checked" };
  }
  const override = process.env.SETTLEMENT_TEST_SERVER_KEY?.trim();
  if (!override) return { ok: true, deployment: pinnedDeployment, keySource: "pinned" };
  try {
    assertTestUpstream("SETTLEMENT_TEST_SERVER_KEY");
  } catch (e) {
    return { ok: false, reason: describeFailure(e) };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(override)) {
    return { ok: false, reason: "SETTLEMENT_TEST_SERVER_KEY must be 64 hex characters" };
  }
  return { ok: true, deployment: { ...pinnedDeployment, serverPublicKeyHex: toHex(Uint8Array.from(Buffer.from(override, "hex"))) }, keySource: "e2e_test" };
}

/** Where the browser sends the form, or why it cannot. */
export function sendApiBase(): { ok: true; base: string } | { ok: false; reason: string } {
  try {
    return { ok: true, base: settlementApiBase() };
  } catch (e) {
    return { ok: false, reason: describeFailure(e) };
  }
}
