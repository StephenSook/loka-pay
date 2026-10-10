import type { ConfFields, ValidatedNote } from '@lokapay/protocol';

export interface PreparedAttempt {
  signature: string;
  rawTransaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}
export interface ChainDecision {
  slot: number;
  blockTime: number;
  error: string | null;
  errorCode: number;
}
export interface ChainGateway {
  bindPayer(note: ValidatedNote): Promise<boolean>;
  prepare(note: ValidatedNote): Promise<PreparedAttempt>;
  send(attempt: PreparedAttempt): Promise<void>;
  observe(signature: string): Promise<ChainDecision | null>;
}
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
  decision: Decision | null;
}
