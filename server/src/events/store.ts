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

interface JournalRow { noteId: string; note: string; ack: string | null; decision: {
  status: 'settled' | 'failed'; error: string | null; signature: string; explorer: string;
  slot: number; blockTime: number; uploadedAt: number; } }

const columns = `seq, note_id AS "noteId", source, status, error, amount_units::text AS "amountUnits", signature, explorer,
  slot::float8 AS slot, block_time::float8 AS "blockTime", uploaded_at::float8 AS "uploadedAt", received_at::float8 AS "receivedAt"`;
const toEvent = (row: Record<string, unknown>): PaymentEvent => ({ ...row, seq: Number(row.seq) } as unknown as PaymentEvent);

export class EventStore {
  constructor(private readonly db: Database, private readonly deployment: P.Deployment,
    private readonly sourceOf: (payerKeyHash: string) => Source = () => 'phone_ble') {}

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
  }

  /**
   * Copies new or changed decisions from the settlement journal and returns the rows written, oldest first.
   * A decision can be replaced once (settle/store.ts finish), so a changed signature rewrites the row with a new seq.
   */
  async project(limit = 200): Promise<PaymentEvent[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(`SELECT s.note_id AS "noteId", s.note, s.ack, s.decision
      FROM settlement_attempts s LEFT JOIN payment_events e ON e.note_id = s.note_id
      WHERE s.decision IS NOT NULL AND (e.note_id IS NULL OR e.signature <> s.decision->>'signature')
      ORDER BY (s.decision->>'blockTime')::bigint, s.note_id LIMIT $1`, [limit]);
    const written: PaymentEvent[] = [];
    for (const row of rows as unknown as JournalRow[]) {
      const fields = this.fields(row);
      if (!fields) continue;
      const result = await this.db.query<Record<string, unknown>>(`INSERT INTO payment_events
        (note_id, seq, source, status, error, amount_units, signature, explorer, slot, block_time, uploaded_at, received_at)
        VALUES ($1, nextval('payment_events_seq'), $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (note_id) DO UPDATE SET seq = nextval('payment_events_seq'), status = EXCLUDED.status,
          error = EXCLUDED.error, signature = EXCLUDED.signature, explorer = EXCLUDED.explorer, slot = EXCLUDED.slot,
          block_time = EXCLUDED.block_time, uploaded_at = EXCLUDED.uploaded_at, received_at = EXCLUDED.received_at
        WHERE payment_events.signature <> EXCLUDED.signature
        RETURNING ${columns}`, fields);
      if (result.rows[0]) written.push(toEvent(result.rows[0]));
    }
    return written;
  }

  /** Newest events after `afterSeq` (oldest first), for SSE catch-up. */
  async since(afterSeq: number, limit: number): Promise<PaymentEvent[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(`SELECT * FROM (SELECT ${columns} FROM payment_events
      WHERE seq > $1 ORDER BY seq DESC LIMIT $2) recent ORDER BY seq`, [afterSeq, limit]);
    return rows.map(toEvent);
  }

  private fields(row: JournalRow): unknown[] | null {
    const d = row.decision;
    let validated: P.ValidatedNote;
    try { validated = P.validateNoteWire(P.base64urlDecode(row.note), this.deployment); } catch { return null; }
    let receivedAt: number | null = null;
    if (row.ack) {
      try { receivedAt = Number(P.verifyAckWire(P.base64urlDecode(row.ack), validated).receivedAt); } catch { receivedAt = null; }
    }
    return [row.noteId, this.sourceOf(P.toHex(validated.payerKeyHash)), d.status, d.error ?? null,
      validated.note.amount.toString(), d.signature, d.explorer, d.slot, d.blockTime, d.uploadedAt, receivedAt];
  }
}
