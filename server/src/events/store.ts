import * as P from '@lokapay/protocol';
import type { Database } from '../settle/store.js';

// Task 2.10. One row per settled or failed note, projected read-only from the settlement journal
// (settle/store.ts owns settlement_attempts; this module never writes it). No key, IP or phone is stored.
export const SOURCES = ['phone_ble', 'relay_upgrade', 'sms_rail', 'lab_simulated', 'canary', 'ci', 'load_test'] as const;
export type Source = typeof SOURCES[number];
/** Excluded from /api/stats unless ?include=all (PLAN.md shared contracts, Settlement API). */
export const EXCLUDED_BY_DEFAULT: readonly Source[] = ['canary', 'ci', 'load_test'];

export interface PaymentEvent {
  seq: number; noteId: string; source: Source; status: 'settled' | 'failed'; error: string | null;
  amountUnits: string; signature: string; explorer: string; slot: number; blockTime: number;
  uploadedAt: number; receivedAt: number | null;
}

/** ACK received-at outside this window (2020-01-01 to one day past upload) is a wrong or hostile clock: stored as null. */
const RECEIVED_AT_MIN = 1_577_836_800;
const RECEIVED_AT_MAX_AHEAD = 86_400;

interface JournalRow { noteId: string; note: string; ack: string | null; decision: {
  status: 'settled' | 'failed'; error: string | null; signature: string; explorer: string;
  slot: number; blockTime: number; uploadedAt: number; } }

const columns = `seq, note_id AS "noteId", source, status, error, amount_units::text AS "amountUnits", signature, explorer,
  slot::float8 AS slot, block_time::float8 AS "blockTime", uploaded_at::float8 AS "uploadedAt", received_at::float8 AS "receivedAt"`;
const toEvent = (row: Record<string, unknown>): PaymentEvent => ({ ...row, seq: Number(row.seq) } as unknown as PaymentEvent);

export class EventStore {
  /** Note ids whose rows cannot be projected; kept out of later selections so one bad row never blocks the rest. */
  private readonly skipped = new Set<string>();

  constructor(private readonly db: Database, private readonly deployment: P.Deployment,
    private readonly sourceOf: (payerKeyHash: string) => Source = () => 'phone_ble',
    private readonly onSkip: (noteId: string, reason: string) => void = () => {}) {}

  async migrate(): Promise<void> {
    await this.db.query('CREATE SEQUENCE IF NOT EXISTS payment_events_seq');
    await this.db.query(`CREATE TABLE IF NOT EXISTS payment_events (
      note_id text PRIMARY KEY CHECK (note_id ~ '^[0-9a-f]{64}$'),
      seq bigint NOT NULL UNIQUE,
      source text NOT NULL CHECK (source IN (${SOURCES.map(s => `'${s}'`).join(',')})),
      status text NOT NULL CHECK (status IN ('settled','failed')),
      error text, amount_units numeric NOT NULL CHECK (amount_units >= 0),
      signature text NOT NULL, explorer text NOT NULL, slot bigint NOT NULL, block_time bigint NOT NULL,
      uploaded_at bigint NOT NULL, received_at bigint
    )`);
    // True once a row was projected with the journal's ACK present, so a later ACK refreshes it exactly once.
    await this.db.query('ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS ack_projected boolean NOT NULL DEFAULT false');
    // Every accepted upload, decided or not, so /api/stats can show pending payments in the denominator.
    await this.db.query(`CREATE TABLE IF NOT EXISTS payment_uploads (
      note_id text PRIMARY KEY CHECK (note_id ~ '^[0-9a-f]{64}$'),
      source text NOT NULL CHECK (source IN (${SOURCES.map(s => `'${s}'`).join(',')})),
      uploaded_at bigint NOT NULL
    )`);
  }

  private skip(noteId: string, reason: string): void {
    if (this.skipped.has(noteId)) return;
    this.skipped.add(noteId);
    this.onSkip(noteId, reason);
  }

  /** Records every accepted upload once (source and upload time never change). Returns how many it added. */
  async projectUploads(limit = 500): Promise<number> {
    const { rows } = await this.db.query<{ noteId: string; note: string; uploadedAt: string }>(`SELECT s.note_id AS "noteId",
        s.note, s.uploaded_at::text AS "uploadedAt"
      FROM settlement_attempts s LEFT JOIN payment_uploads u ON u.note_id = s.note_id
      WHERE u.note_id IS NULL AND NOT (s.note_id = ANY($2::text[])) ORDER BY s.uploaded_at, s.note_id LIMIT $1`,
    [limit, [...this.skipped]]);
    let added = 0;
    for (const row of rows) {
      const validated = this.validate(row.noteId, row.note);
      if (!validated) continue;
      try {
        const result = await this.db.query(`INSERT INTO payment_uploads (note_id, source, uploaded_at) VALUES ($1, $2, $3)
          ON CONFLICT (note_id) DO NOTHING RETURNING note_id`,
        [row.noteId, this.sourceOf(P.toHex(validated.payerKeyHash)), row.uploadedAt]);
        added += result.rows.length;
      } catch { this.skip(row.noteId, 'upload_write_failed'); }
    }
    return added;
  }

  /**
   * Copies new or changed decisions from the settlement journal and returns how many rows it wrote. A row is
   * rewritten with a new seq when its decision is replaced (settle/store.ts finish) or when an ACK arrives after
   * settlement (settle/store.ts attachAck). Readers find written rows by seq (since), so a write that fails
   * part way through still leaves every saved row deliverable.
   */
  async project(limit = 200): Promise<number> {
    const { rows } = await this.db.query<Record<string, unknown>>(`SELECT s.note_id AS "noteId", s.note, s.ack, s.decision
      FROM settlement_attempts s LEFT JOIN payment_events e ON e.note_id = s.note_id
      WHERE s.decision IS NOT NULL AND (e.note_id IS NULL OR e.signature <> s.decision->>'signature'
        OR (s.ack IS NOT NULL AND NOT e.ack_projected)) AND NOT (s.note_id = ANY($2::text[]))
      ORDER BY (s.decision->>'blockTime')::bigint, s.note_id LIMIT $1`, [limit, [...this.skipped]]);
    let written = 0;
    for (const row of rows as unknown as JournalRow[]) {
      const fields = this.fields(row);
      if (!fields) continue;
      // One row that cannot be written is skipped and reported; it must not stop the rows behind it.
      let result;
      try {
        result = await this.db.query<Record<string, unknown>>(`INSERT INTO payment_events
        (note_id, seq, source, status, error, amount_units, signature, explorer, slot, block_time, uploaded_at, received_at, ack_projected)
        VALUES ($1, nextval('payment_events_seq'), $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (note_id) DO UPDATE SET seq = nextval('payment_events_seq'), status = EXCLUDED.status,
          error = EXCLUDED.error, signature = EXCLUDED.signature, explorer = EXCLUDED.explorer, slot = EXCLUDED.slot,
          block_time = EXCLUDED.block_time, uploaded_at = EXCLUDED.uploaded_at, received_at = EXCLUDED.received_at,
          ack_projected = EXCLUDED.ack_projected
        WHERE payment_events.signature <> EXCLUDED.signature
          OR (EXCLUDED.ack_projected AND NOT payment_events.ack_projected)
        RETURNING note_id`, fields);
      } catch { this.skip(row.noteId, 'event_write_failed'); continue; }
      written += result.rows.length;
    }
    return written;
  }

  /** The next events after `afterSeq`, oldest first: page through a gap without skipping any. */
  async since(afterSeq: number, limit: number): Promise<PaymentEvent[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(`SELECT ${columns} FROM payment_events
      WHERE seq > $1 ORDER BY seq LIMIT $2`, [afterSeq, limit]);
    return rows.map(toEvent);
  }

  /** The newest `limit` events, oldest first: the backlog for a viewer with nothing to resume. */
  async latest(limit: number): Promise<PaymentEvent[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(`SELECT * FROM (SELECT ${columns} FROM payment_events
      ORDER BY seq DESC LIMIT $1) recent ORDER BY seq`, [limit]);
    return rows.map(toEvent);
  }

  async maxSeq(): Promise<number> {
    const { rows } = await this.db.query<{ seq: string | null }>('SELECT MAX(seq)::text AS seq FROM payment_events');
    return Number(rows[0]?.seq ?? 0);
  }

  private validate(noteId: string, note: string): P.ValidatedNote | null {
    try { return P.validateNoteWire(P.base64urlDecode(note), this.deployment); } catch { this.skip(noteId, 'note_unreadable'); return null; }
  }

  private fields(row: JournalRow): unknown[] | null {
    const d = row.decision;
    const validated = this.validate(row.noteId, row.note);
    if (!validated) return null;
    // The ACK time is the merchant phone's signed clock, so any signer can put any i64 there. Keep it only when
    // it is a plausible time, or one hostile ACK would overflow bigint and make the row unwritable.
    let receivedAt: number | null = null;
    if (row.ack) {
      try {
        const signed = P.verifyAckWire(P.base64urlDecode(row.ack), validated).receivedAt;
        if (signed >= BigInt(RECEIVED_AT_MIN) && signed <= BigInt(d.uploadedAt + RECEIVED_AT_MAX_AHEAD)) receivedAt = Number(signed);
      } catch { receivedAt = null; }
    }
    return [row.noteId, this.sourceOf(P.toHex(validated.payerKeyHash)), d.status, d.error ?? null,
      validated.note.amount.toString(), d.signature, d.explorer, d.slot, d.blockTime, d.uploadedAt, receivedAt, row.ack !== null];
  }
}
