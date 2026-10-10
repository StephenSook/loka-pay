// The settlement API's health check (protocol/API-V1.md section 6, server/src/app/app.ts),
// read on our server and cached (lib/cached-read.ts) for the /proof server claim and for
// /send, which is on only while the answer reports POST /v1/remittances. Server only.
//
// The server answers 200 with ok true, its commit, the cluster, the program id and a slot it
// read from devnet for that request, or 503 with ok false when it cannot reach devnet. Any
// other answer, a timeout, a refused connection or an unexpected shape fails the read with a
// reason that says which; a failed read is never replaced by a typed-in value.

import { cachedRead, sourceTag, type CachedReadOptions, type Read, type ReadPolicy } from "./cached-read";
import { UpstreamConfigError, assertTestUpstream, isLoopback } from "./test-upstream";

/** The deployed settlement API (protocol/API-V1.md section 1). */
export const SETTLEMENT_API = "https://api.zerobars.us";
export const HEALTH_PATH = "/api/health";
/** The page a judge opens to check the claim: always the real server, whatever the reads use. */
export const SETTLEMENT_HEALTH_URL = `${SETTLEMENT_API}${HEALTH_PATH}`;

/** SETTLEMENT_API_URL as set, unchecked: only for telling cache entries of different endpoints apart. */
function settlementApiSource(): string {
  return process.env.SETTLEMENT_API_URL?.trim() || SETTLEMENT_API;
}

/**
 * The settlement API base: https://api.zerobars.us. SETTLEMENT_API_URL (server only) may replace
 * it only with a local test endpoint, only in the e2e test mode, and never in a deployed
 * production build (lib/test-upstream.ts); anything else throws UpstreamConfigError, so the read
 * fails with that reason and no other host's answer ever counts as the server's. Read when each
 * request is made.
 */
export function settlementApiBase(): string {
  const override = process.env.SETTLEMENT_API_URL?.trim();
  if (!override) return SETTLEMENT_API;
  if (!isLoopback(override)) {
    throw new UpstreamConfigError("SETTLEMENT_API_URL may only name a local test endpoint; the settlement API is always https://api.zerobars.us");
  }
  assertTestUpstream("SETTLEMENT_API_URL");
  return override.replace(/\/+$/, "");
}

/**
 * Health reads: cached 30 s; current for 10 s, reused by /proof for 7 s so a reused read is still
 * current when the page renders; at most 3 reads per 10 s in one server process; a minute without
 * a read after the server's burst guard answers 429 (it says Retry-After: 60).
 */
export const SETTLEMENT_READS: ReadPolicy = {
  revalidateSeconds: 30,
  currentForMs: 10_000,
  reuseForMs: 7_000,
  limits: { reads: 3, perMs: 10_000, rateLimitPauseMs: 60_000 },
};

export interface ServerHealth {
  /** True with HTTP 200; false with HTTP 503, when the server says it cannot reach devnet. */
  ok: boolean;
  /** The commit the server says it runs, as it reports it (a git sha, or "uncommitted"). */
  commit: string;
  cluster: string;
  programId: string;
  /** The slot the server read from devnet for this request; null when ok is false. */
  slot: number | null;
  /**
   * POST /v1/remittances (API-V1 section 9) as the health answer's `phase3Routes` reports it:
   * registered, or not with the server's reason (missing_config, invalid_config,
   * initialization_failed). Null when the answer has no readable entry for it, as from a server
   * built before that route existed. /send takes only `registered: true` as on.
   */
  remittances: RouteState | null;
}

export type RouteState = { registered: true } | { registered: false; reason: string };

/** The remittance route's entry in a health body's `phase3Routes`, or null when there is none to read. */
export function remittanceRoute(body: unknown): RouteState | null {
  const routes = (body as { phase3Routes?: unknown } | null)?.phase3Routes;
  if (typeof routes !== "object" || routes === null || Array.isArray(routes)) return null;
  const entry = (routes as Record<string, unknown>)["/v1/remittances"] as { registered?: unknown; reason?: unknown } | undefined;
  if (typeof entry !== "object" || entry === null || typeof entry.registered !== "boolean") return null;
  if (entry.registered) return { registered: true };
  return { registered: false, reason: typeof entry.reason === "string" && entry.reason ? entry.reason : "no reason given" };
}

export class SettlementError extends Error {
  /** True when the server's burst guard refused (429): the read is paused, never retried (lib/read-state.ts). */
  readonly rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.name = "SettlementError";
    this.rateLimited = rateLimited;
  }
}

const isSlot = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/**
 * Reduces a health answer to what the claim reads. Throws SettlementError on any status other
 * than 200 or 503, and on a body that is not the shape API-V1 section 6 names for that status.
 */
export function summarizeHealth(status: number, body: unknown, host: string): ServerHealth {
  if (status === 429) throw new SettlementError(`${host} answered 429: its limit for this site's requests is used up for a minute`, true);
  if (status !== 200 && status !== 503) throw new SettlementError(`${host} answered HTTP ${status}`);
  const b = body as { ok?: unknown; commit?: unknown; cluster?: unknown; programId?: unknown; slot?: unknown } | null;
  const named = !!b && typeof b === "object" && typeof b.commit === "string" && typeof b.cluster === "string" && typeof b.programId === "string";
  if (status === 200) {
    if (!named || b!.ok !== true || !isSlot(b!.slot)) throw new SettlementError(`${host}'s health answer had an unexpected shape`);
    return { ok: true, commit: b!.commit as string, cluster: b!.cluster as string, programId: b!.programId as string, slot: b!.slot as number, remittances: remittanceRoute(b) };
  }
  if (!named || b!.ok !== false) throw new SettlementError(`${host} answered HTTP 503 without its health answer`);
  return { ok: false, commit: b!.commit as string, cluster: b!.cluster as string, programId: b!.programId as string, slot: null, remittances: remittanceRoute(b) };
}

/** The health read. The URL and limit are parameters only so tests can point it at a local server. */
export async function readServerHealthUncached(url: string = `${settlementApiBase()}${HEALTH_PATH}`, timeoutMs = 10_000): Promise<ServerHealth> {
  const host = new URL(url).host;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "loka-pay-web (https://zerobars.us)" },
      // lib/cached-read.ts caches the decoded answer with its read time, never the raw response.
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Only a timeout is a timeout; a refused connection or a DNS failure says so.
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new SettlementError(`${host} did not answer within ${timeoutMs / 1000} s`);
    throw new SettlementError(`could not reach ${host}`);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new SettlementError(`${host} did not finish answering within ${timeoutMs / 1000} s`);
    // Not JSON: summarizeHealth names the status, or says the shape was unexpected.
  }
  return summarizeHealth(response.status, body, host);
}

/** `needCurrent` for a page whose claims say Live (lib/cached-read.ts). */
export function readServerHealth(options: CachedReadOptions = {}): Promise<Read<ServerHealth>> {
  return cachedRead(`settlement-health:${sourceTag(settlementApiSource())}`, SETTLEMENT_READS, () => readServerHealthUncached(), options);
}
