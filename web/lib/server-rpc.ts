// The Solana RPC endpoint for reads made on our server (lib/chain.ts for /judge, /proof and
// /trust). Server only: SOLANA_RPC_URL has no NEXT_PUBLIC prefix, so Next never inlines it
// into a browser bundle, and it may carry a provider API key. Unset, the server uses the
// same endpoint as the browser (lib/solana.ts RPC_URL).

import { RPC_URL, type RpcOptions } from "./solana";

export const SERVER_RPC_URL = process.env.SOLANA_RPC_URL || RPC_URL;

/** Options for every call one server read makes. */
export function serverReadOptions(): RpcOptions {
  return { url: SERVER_RPC_URL };
}
