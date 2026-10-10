import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import type { AttemptRow, ChainGateway, ConfirmationSigner, Decision, Outcome } from './types.js';
import { SettlementStore } from './store.js';
import { HttpError, validateUpload } from './validation.js';

export interface SettlementOptions {
  deployment: P.Deployment;
  store: SettlementStore;
  chain: ChainGateway;
  signConfirmation: ConfirmationSigner;
  now?: () => number;
}

export class SettlementService {
  constructor(private readonly options: SettlementOptions) {
    if (options.deployment.clusterId !== 0) throw new Error('This settlement module is devnet sandbox only');
  }

  async submit(input: unknown): Promise<Outcome> {
    // Revalidate even repeats before consulting the journal. A refusal is never stored or signed.
    const upload = validateUpload(input, this.options.deployment);
    let bound: boolean;
    try { bound = await this.options.chain.bindPayer(upload.validated); }
    catch { throw new HttpError(503, 'chain_unavailable'); }
    if (!bound) throw new HttpError(422, 'payer_mismatch');
    const uploadedAt = Math.floor((this.options.now ?? (() => Date.now() / 1000))());
    const claim = { noteId: upload.noteId, note: upload.note, ack: upload.ack, uploadedAt };
    const won = await this.options.store.claim(claim);
    if (!won) {
      if (upload.ack) await this.options.store.attachAck(upload.noteId, upload.ack);
      return this.get(upload.noteId);
    }
    let row: AttemptRow = { ...claim, attempt: null, decision: null };
    try {
      const attempt = await this.options.chain.prepare(upload.validated);
      // Commit before broadcast. Only this claim's winner can ever send; there is no takeover worker.
      await this.options.store.saveAttempt(upload.noteId, attempt);
      row = { ...row, attempt };
      await this.options.chain.send(attempt);
    } catch {
      // A timeout cannot tell us whether the transaction landed. Never retry, even after expiry.
      return this.pending(row);
    }
    return this.resolve(row, false);
  }

  async get(noteId: string): Promise<Outcome> {
    if (!/^[0-9a-f]{64}$/.test(noteId)) throw new HttpError(404, 'unknown_note');
    const row = await this.options.store.get(noteId);
    if (!row) throw new HttpError(404, 'unknown_note');
    return this.resolve(row, true);
  }

  private pending(row: AttemptRow): Outcome {
    return { statusCode: 202, body: { noteId: row.noteId, status: 'pending', signature: row.attempt?.signature ?? null, retryAfter: 2 } };
  }

  private async resolve(row: AttemptRow, replayed: boolean): Promise<Outcome> {
    if (row.decision) return { statusCode: 200, body: { ...row.decision, replayed } };
    if (!row.attempt) return this.pending(row);
    try {
      const chain = await this.options.chain.observe(row.attempt.signature);
      if (!chain) return this.pending(row);
      const conf = await this.options.signConfirmation({
        noteId: P.fromHex(row.noteId), txSignature: base58.decode(row.attempt.signature), slot: BigInt(chain.slot),
        blockTime: BigInt(chain.blockTime), uploadedAt: BigInt(row.uploadedAt),
        status: chain.error === null ? 'settled' : 'failed_on_chain', errorCode: chain.errorCode,
      });
      const decision: Decision = {
        noteId: row.noteId, status: chain.error === null ? 'settled' : 'failed', ...chain,
        conf: P.base64urlEncode(conf), signature: row.attempt.signature, uploadedAt: row.uploadedAt,
        explorer: `https://explorer.solana.com/tx/${row.attempt.signature}?cluster=devnet`,
      };
      const saved = await this.options.store.finish(row.noteId, decision);
      return { statusCode: 200, body: { ...saved, replayed } };
    } catch {
      // RPC, signer or database uncertainty must not create a false final decision.
      return this.pending(row);
    }
  }
}
