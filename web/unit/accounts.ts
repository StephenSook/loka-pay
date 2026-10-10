// Test-only builders for the account bytes the reserves reader decodes, field by field in
// the layouts of programs/loka_vault/src/state.rs and the SPL Token account (TEST FIXTURES).

import { ACCOUNT_DISCRIMINATORS } from "../lib/vault";
import { concat, filled, le32, le64, padTo, pubkey } from "./bytes";

const ALLOWANCE_SIZE = 670; // 8 + Allowance::INIT_SPACE (earmarks allocated at 16)
const MERCHANT_SIZE = 90; // 8 + Merchant::INIT_SPACE
const TOKEN_ACCOUNT_SIZE = 165;

export function allowanceBytes(fields: { id: bigint; cap: bigint; redeemed: bigint; bond: bigint; funder: string }): Uint8Array {
  return padTo(
    concat(
      [...ACCOUNT_DISCRIMINATORS.Allowance],
      le64(fields.id),
      pubkey(fields.funder),
      concat([0x02], filled(32, 0x11)), // payer_key, compressed P-256
      le64(fields.cap),
      le64(fields.redeemed),
      le64(BigInt(1_000_000)), // offline_limit
      le64(BigInt(1_800_000_000)), // expiry
      le64(fields.bond),
      le32(0), // no earmarks
      filled(32, 0), // used_serials
      [254], // bump
    ),
    ALLOWANCE_SIZE,
  );
}

export function merchantBytes(balance: bigint): Uint8Array {
  return padTo(
    concat([...ACCOUNT_DISCRIMINATORS.Merchant], concat([0x03], filled(32, 0x22)), filled(32, 0x33), le64(balance), le64(BigInt(0)), [253]),
    MERCHANT_SIZE,
  );
}

/** An SPL Token account: mint, owner (the authority), amount, then the rest of its 165 bytes zero. */
export function tokenAccountBytes(mint: string, authority: string, amount: bigint): Uint8Array {
  return padTo(concat(pubkey(mint), pubkey(authority), le64(amount)), TOKEN_ACCOUNT_SIZE);
}
