// The Solana RPC endpoint and call options for reads made on our server (lib/chain.ts for
// /judge, /proof and /trust). Server only: SOLANA_RPC_URL has no NEXT_PUBLIC prefix, so Next
// never inlines it into a browser bundle, and it may carry a provider API key. Unset, the
// server uses the same endpoint as the browser (lib/solana.ts RPC_URL).

import { RPC_URL, deadlineIn, type RpcOptions } from "./solana";

export const SERVER_RPC_URL = process.env.SOLANA_RPC_URL || RPC_URL;

/**
 * Every call of one server read shares this total limit, so a hanging node cannot hold
 * /judge or /proof until the host's own function timeout: the page renders the honest
 * failure instead. GitHub's compare read has the same 10 s limit (lib/github.ts).
 */
export const SERVER_READ_DEADLINE_MS = 10_000;

/**
 * Options for every call one server read makes: the server endpoint, no retries (a retry
 * would only spend the read's time limit), and a deadline that starts now. Call it once at
 * the start of each read.
 */
export function serverReadOptions(deadlineMs: number = SERVER_READ_DEADLINE_MS): RpcOptions {
  return { url: SERVER_RPC_URL, retries: 0, deadline: deadlineIn(deadlineMs) };
}
