import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import type { AttemptRow, ChainDecision, ChainGateway, ConfirmationSigner, Decision, Outcome, PendingStage } from './types.js';
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
    let refusal;
    try { refusal = await this.options.chain.checkIdentity(upload.validated); }
    catch { throw new HttpError(503, 'chain_unavailable'); }
    if (refusal !== null) throw new HttpError(422, refusal);
    const uploadedAt = Math.floor((this.options.now ?? (() => Date.now() / 1000))());
    const claim = { noteId: upload.noteId, note: upload.note, ack: upload.ack, uploadedAt };
    const won = await this.options.store.claim(claim);
    if (!won) {
      if (upload.ack) await this.options.store.attachAck(upload.noteId, upload.ack);
      return this.get(upload.noteId);
    }
    let row: AttemptRow = { ...claim, attempt: null, replacement: null, rebuildClaimed: false, decision: null };
    let stage: PendingStage = 'prepare';
    try {
      const attempt = await this.options.chain.prepare(upload.validated);
      // Commit before broadcast. This claim's winner alone sends the original transaction.
      stage = 'save_attempt';
      await this.options.store.saveAttempt(upload.noteId, attempt);
      row = { ...row, attempt };
      stage = 'send';
      await this.options.chain.send(attempt);
    } catch {
      // A timeout cannot tell us whether it landed. Only the expiry/history gate can allow a rebuild.
      return this.pending(row, stage, true);
    }
    return this.resolve(row, false);
  }

  async get(noteId: string): Promise<Outcome> {
    if (!/^[0-9a-f]{64}$/.test(noteId)) throw new HttpError(404, 'unknown_note');
    const row = await this.options.store.get(noteId);
    if (!row) throw new HttpError(404, 'unknown_note');
    return this.resolve(row, true);
  }

  private async pending(row: AttemptRow, stage: PendingStage = 'awaiting_confirmation', failed = false): Promise<Outcome> {
    try { await this.options.store.markPending(row.noteId, stage, failed); }
    catch { /* A diagnostic write failure cannot turn an uncertain send into a final refusal. */ }
    return { statusCode: 202, body: { noteId: row.noteId, status: 'pending',
      signature: row.replacement?.signature ?? row.attempt?.signature ?? null, retryAfter: 2 } };
  }

  private async resolve(row: AttemptRow, replayed: boolean): Promise<Outcome> {
    if (row.decision && row.decision.signature === row.attempt?.signature) return { statusCode: 200, body: { ...row.decision, replayed } };
    if (!row.attempt) return this.pending(row, 'missing_attempt');
    let stage: PendingStage = 'lookup';
    try {
      const original = await this.options.chain.lookup(row.attempt.signature);
      if (original.decision) return await this.finalize(row, row.attempt.signature, original.decision, replayed);
      if (row.decision) return { statusCode: 200, body: { ...row.decision, replayed } };
      if (original.found) return this.pending(row);
      if (row.replacement) {
        const current = await this.options.chain.lookup(row.replacement.signature);
        if (!current.decision) return this.pending(row);
        const again = await this.options.chain.lookup(row.attempt.signature);
        if (again.decision) return await this.finalize(row, row.attempt.signature, again.decision, replayed);
        if (again.found) return this.pending(row);
        return await this.finalize(row, row.replacement.signature, current.decision, replayed);
      }
      if (row.rebuildClaimed) return this.pending(row, 'rebuild_consumed');
      stage = 'height_lookup';
      const height = await this.options.chain.blockHeight();
      if (!Number.isSafeInteger(height) || height <= row.attempt.lastValidBlockHeight) return this.pending(row);
      // The history search must occur after the expiry observation, not from a cached lookup.
      stage = 'lookup';
      const atExpiry = await this.options.chain.lookup(row.attempt.signature);
      if (atExpiry.decision) return await this.finalize(row, row.attempt.signature, atExpiry.decision, replayed);
      if (atExpiry.found) return this.pending(row);
      stage = 'rebuild_claim';
      if (!await this.options.store.claimRebuild(row.noteId, row.attempt.signature)) return this.pending(row);
      row = { ...row, rebuildClaimed: true };
      stage = 'lookup';
      const beforeSign = await this.options.chain.lookup(row.attempt!.signature);
      if (beforeSign.decision) return await this.finalize(row, row.attempt!.signature, beforeSign.decision, replayed);
      if (beforeSign.found) return this.pending(row);
      stage = 'rebuild_prepare';
      const upload = validateUpload({ note: row.note, ...(row.ack ? { ack: row.ack } : {}) }, this.options.deployment);
      const replacement = await this.options.chain.prepare(upload.validated);
      if (replacement.signature === row.attempt!.signature || replacement.blockhash === row.attempt!.blockhash
        || replacement.lastValidBlockHeight <= height) throw new Error('Replacement requires a fresh blockhash');
      stage = 'rebuild_save';
      await this.options.store.saveReplacement(row.noteId, replacement);
      row = { ...row, replacement };
      stage = 'rebuild_send';
      await this.options.chain.send(replacement);
      return this.resolve(row, replayed);
    } catch {
      if (row.decision) return { statusCode: 200, body: { ...row.decision, replayed } };
      return this.pending(row, stage, true);
    }
  }

  private async finalize(row: AttemptRow, signature: string, chain: ChainDecision, replayed: boolean): Promise<Outcome> {
    let stage: PendingStage = 'sign_confirmation';
    try {
      const conf = await this.options.signConfirmation({
        noteId: P.fromHex(row.noteId), txSignature: base58.decode(signature), slot: BigInt(chain.slot),
        blockTime: BigInt(chain.blockTime), uploadedAt: BigInt(row.uploadedAt),
        status: chain.error === null ? 'settled' : 'failed_on_chain', errorCode: chain.errorCode,
      });
      const decision: Decision = {
        noteId: row.noteId, status: chain.error === null ? 'settled' : 'failed', ...chain,
        conf: P.base64urlEncode(conf), signature, uploadedAt: row.uploadedAt,
        explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      };
      stage = 'save_decision';
      const saved = await this.options.store.finish(row.noteId, decision);
      return { statusCode: 200, body: { ...saved, replayed } };
    } catch { return this.pending(row, stage, true); }
  }
}
