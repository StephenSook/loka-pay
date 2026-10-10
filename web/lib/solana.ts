// A small JSON-RPC client for Solana devnet, used by the server pages (through lib/chain.ts,
// which caches) and by /live in the browser. No Solana package: the pages need a handful of
// read methods, and every response is checked by the decoders in lib/vault.ts.
//
// NEXT_PUBLIC_SOLANA_RPC_URL and NEXT_PUBLIC_SOLANA_WS_URL override the public devnet
// endpoints the BROWSER uses (/live; listed in web/.env.example). Next inlines them into
// every visitor's page, so they are public: a keyed endpoint (a provider URL with
// ?api-key=...) is refused at build time and belongs in SOLANA_RPC_URL, which only the
// server reads (lib/server-rpc.ts).

export const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

/**
 * A NEXT_PUBLIC endpoint, or the fallback when unset. Throws (failing `next build`) when the
 * URL carries a query string or a user name or password, where providers put API keys. The
 * error names the variable, never its value, so a build log does not print the key.
 */
export function publicEndpoint(name: string, value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a URL`);
  }
  if (url.search !== "" || url.username !== "" || url.password !== "") {
    throw new Error(
      `${name} is inlined into every visitor's browser, so it must not carry a query string or credentials; put a keyed endpoint in SOLANA_RPC_URL, which only the server reads`,
    );
  }
  return value;
}

export const RPC_URL = publicEndpoint("NEXT_PUBLIC_SOLANA_RPC_URL", process.env.NEXT_PUBLIC_SOLANA_RPC_URL, DEFAULT_RPC_URL);

/** The WebSocket endpoint: the override, or the RPC URL with http(s) swapped for ws(s). */
export function wsUrlFor(httpUrl: string): string {
  return httpUrl.replace(/^http(s?):\/\//, (_m, s: string) => `ws${s}://`);
}

export const WS_URL = publicEndpoint("NEXT_PUBLIC_SOLANA_WS_URL", process.env.NEXT_PUBLIC_SOLANA_WS_URL, wsUrlFor(RPC_URL));

/** The distinct host names of some endpoints, in order: what a page names (never a path or query). */
export function hostsOf(...urls: string[]): string[] {
  return [...new Set(urls.map((u) => new URL(u).host))];
}

export const EXPLORER_BASE = "https://explorer.solana.com";

export function explorerTx(signature: string): string {
  return `${EXPLORER_BASE}/tx/${signature}?cluster=devnet`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_BASE}/address/${address}?cluster=devnet`;
}

export type RpcErrorKind = "timeout" | "network" | "http" | "rpc" | "shape";

export class RpcError extends Error {
  readonly kind: RpcErrorKind;
  /** HTTP status for kind "http", the JSON-RPC error code for kind "rpc". */
  readonly code: number | null;
  constructor(kind: RpcErrorKind, message: string, code: number | null = null) {
    super(message);
    this.name = "RpcError";
    this.kind = kind;
    this.code = code;
  }
}

export interface RpcRequest {
  method: string;
  params: unknown[];
}

export type RpcOutcome = { ok: true; result: unknown } | { ok: false; error: RpcError };

/** A time limit shared by every call of one read: the signal that fires, and its length for the message. */
export interface Deadline {
  signal: AbortSignal;
  ms: number;
}

/** A deadline that passes `ms` milliseconds from now. */
export function deadlineIn(ms: number): Deadline {
  return { signal: AbortSignal.timeout(ms), ms };
}

export interface RpcOptions {
  url?: string;
  /** Per attempt. Default 8 seconds. */
  timeoutMs?: number;
  /** Extra attempts after a timeout, a network error or a 5xx. Default 1. */
  retries?: number;
  /** A total limit for a whole read: once it passes, every call made with it stops at once. */
  deadline?: Deadline;
}

const RETRY_DELAY_MS = 400;

// HTTP 429 is not retried: public devnet answers it with Retry-After: 10, so an early
// retry only spends more of the same limit. The page says the read was rate limited.
function retryable(error: RpcError): boolean {
  if (error.kind === "timeout" || error.kind === "network") return true;
  return error.kind === "http" && error.code !== null && error.code >= 500;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postOnce(url: string, body: string, timeoutMs: number, deadline: Deadline | undefined): Promise<unknown> {
  const host = new URL(url).host;
  const timedOut = () =>
    deadline?.signal.aborted
      ? new RpcError("timeout", `no answer from ${host} within this read's ${deadline.ms / 1000} s limit`)
      : new RpcError("timeout", `no answer from ${host} within ${timeoutMs / 1000} s`);
  if (deadline?.signal.aborted) throw timedOut();
  const perAttempt = AbortSignal.timeout(timeoutMs);
  // The deadline is only passed by server reads (lib/server-rpc.ts), so the browser never
  // needs AbortSignal.any.
  const signal = deadline ? AbortSignal.any([perAttempt, deadline.signal]) : perAttempt;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // Never let the framework cache a raw RPC response: lib/chain.ts caches the
      // decoded result together with the time it was read.
      cache: "no-store",
      signal,
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw timedOut();
    throw new RpcError("network", `could not reach ${host}`);
  }
  if (response.status === 429) {
    throw new RpcError("http", `${new URL(url).host} is rate limiting requests (HTTP 429)`, 429);
  }
  if (!response.ok) {
    throw new RpcError("http", `${new URL(url).host} answered HTTP ${response.status}`, response.status);
  }
  try {
    return await response.json();
  } catch {
    // A body still arriving when a limit passed is a timeout, not a malformed answer.
    if (signal.aborted) throw timedOut();
    throw new RpcError("shape", `${host} sent a body that is not JSON`);
  }
}

async function post(url: string, body: string, options: RpcOptions): Promise<unknown> {
  const attempts = 1 + (options.retries ?? 1);
  let last: RpcError | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);
    try {
      return await postOnce(url, body, options.timeoutMs ?? 8000, options.deadline);
    } catch (e) {
      last = e instanceof RpcError ? e : new RpcError("network", String(e));
      if (!retryable(last) || options.deadline?.signal.aborted) throw last;
    }
  }
  throw last ?? new RpcError("network", "no attempt was made");
}

function outcomeOf(message: unknown): RpcOutcome {
  if (typeof message !== "object" || message === null) {
    return { ok: false, error: new RpcError("shape", "a JSON-RPC answer was not an object") };
  }
  const m = message as { result?: unknown; error?: { code?: unknown; message?: unknown } };
  if (m.error) {
    const code = typeof m.error.code === "number" ? m.error.code : null;
    const text = typeof m.error.message === "string" ? m.error.message : "unknown JSON-RPC error";
    return { ok: false, error: new RpcError("rpc", text, code) };
  }
  if (!("result" in m)) return { ok: false, error: new RpcError("shape", "a JSON-RPC answer had no result") };
  return { ok: true, result: m.result };
}

/**
 * Sends several calls in one HTTP request (a JSON-RPC batch) and returns one outcome per
 * call, in the order given. The node may answer a batch in any order, so answers are
 * matched by id. Throws RpcError only when the HTTP request itself fails.
 */
export async function rpcBatch(requests: RpcRequest[], options: RpcOptions = {}): Promise<RpcOutcome[]> {
  if (requests.length === 0) return [];
  const body = JSON.stringify(requests.map((r, id) => ({ jsonrpc: "2.0", id, method: r.method, params: r.params })));
  const answer = await post(options.url ?? RPC_URL, body, options);
  if (!Array.isArray(answer)) {
    // A node that refuses batches answers with one error object.
    const single = outcomeOf(answer);
    const error = single.ok ? new RpcError("shape", "a batch answer was not a list") : single.error;
    return requests.map(() => ({ ok: false, error }));
  }
  const byId = new Map<number, unknown>();
  for (const item of answer) {
    if (typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "number") {
      byId.set((item as { id: number }).id, item);
    }
  }
  return requests.map((r, id) =>
    byId.has(id) ? outcomeOf(byId.get(id)) : { ok: false, error: new RpcError("shape", `no answer for ${r.method}`) },
  );
}

/** One call. Throws RpcError on any failure. */
export async function rpc(method: string, params: unknown[], options: RpcOptions = {}): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 0, method, params });
  const outcome = outcomeOf(await post(options.url ?? RPC_URL, body, options));
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}

/** The result of a call in a batch, or throws its error. */
export function unwrap(outcome: RpcOutcome): unknown {
  if (!outcome.ok) throw outcome.error;
  return outcome.result;
}

/** Decodes standard base64 (as the RPC sends account data) into bytes. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Reads `[base64, "base64"]` account data from an RPC answer. */
export function accountData(data: unknown): Uint8Array {
  if (!Array.isArray(data) || typeof data[0] !== "string" || data[1] !== "base64") {
    throw new RpcError("shape", "account data was not base64");
  }
  return fromBase64(data[0]);
}

/** `{ context: { slot }, value }` from methods called with context. */
export function withContext(result: unknown): { slot: number; value: unknown } {
  const r = result as { context?: { slot?: unknown }; value?: unknown } | null;
  if (!r || typeof r !== "object" || typeof r.context?.slot !== "number" || !("value" in r)) {
    throw new RpcError("shape", "an answer had no context slot");
  }
  return { slot: r.context.slot, value: r.value };
}

/** A short reason for a failed read, for the page to show. */
export function describeFailure(error: unknown): string {
  if (error instanceof RpcError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
