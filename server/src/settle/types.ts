import type { ConfFields, ValidatedNote } from '@lokapay/protocol';

export interface PreparedAttempt {
  signature: string;
  rawTransaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}
export type PendingStage = 'prepare' | 'save_attempt' | 'send' | 'lookup' | 'height_lookup'
  | 'rebuild_claim' | 'rebuild_prepare' | 'rebuild_save' | 'rebuild_send' | 'sign_confirmation'
  | 'save_decision' | 'awaiting_confirmation' | 'missing_attempt' | 'rebuild_consumed';
export interface ChainDecision {
  slot: number;
  blockTime: number;
  error: string | null;
  errorCode: number;
}
export interface ChainGateway {
  checkIdentity(note: ValidatedNote): Promise<IdentityRefusal | null>;
  blockHeight(): Promise<number>;
  lookup(signature: string): Promise<{ found: boolean; decision: ChainDecision | null }>;
  prepare(note: ValidatedNote): Promise<PreparedAttempt>;
  send(attempt: PreparedAttempt): Promise<void>;
  observe(signature: string): Promise<ChainDecision | null>;
}
export type IdentityRefusal = 'unknown_allowance' | 'unknown_merchant' | 'payer_mismatch';
export type ConfirmationSigner = (fields: ConfFields) => Uint8Array | Promise<Uint8Array>;
export interface Decision extends ChainDecision {
  noteId: string;
  status: 'settled' | 'failed';
  conf: string;
  signature: string;
  uploadedAt: number;
  explorer: string;
}
export interface Pending {
  noteId: string;
  status: 'pending';
  signature: string | null;
  retryAfter: number;
}
export type Outcome =
  | { statusCode: 200; body: Decision & { replayed: boolean } }
  | { statusCode: 202; body: Pending };
export interface Claim {
  noteId: string;
  note: string;
  ack: string | null;
  uploadedAt: number;
}
export interface AttemptRow extends Claim {
  attempt: PreparedAttempt | null;
  replacement: PreparedAttempt | null;
  rebuildClaimed: boolean;
  decision: Decision | null;
}
