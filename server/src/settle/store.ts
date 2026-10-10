import type { AttemptRow, Claim, Decision, PreparedAttempt } from './types.js';

// Both pg.Pool and PGlite implement this interface. Production must use durable PostgreSQL.
export interface Database {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export class SettlementStore {
  constructor(private readonly db: Database) {}

  async migrate(): Promise<void> {
    await this.db.query(`CREATE TABLE IF NOT EXISTS settlement_attempts (
      note_id text PRIMARY KEY CHECK (note_id ~ '^[0-9a-f]{64}$'),
      note text NOT NULL, ack text, uploaded_at bigint NOT NULL,
      attempt jsonb, decision jsonb,
      CHECK (decision IS NULL OR attempt IS NOT NULL)
    )`);
  }

  async claim(row: Claim): Promise<boolean> {
    const result = await this.db.query(`INSERT INTO settlement_attempts (note_id,note,ack,uploaded_at)
      VALUES ($1,$2,$3,$4) ON CONFLICT (note_id) DO NOTHING RETURNING note_id`,
    [row.noteId, row.note, row.ack, row.uploadedAt]);
    return result.rows.length === 1;
  }

  async get(noteId: string): Promise<AttemptRow | null> {
    const result = await this.db.query(`SELECT note_id AS "noteId", note, ack,
      uploaded_at::text AS "uploadedAt", attempt, decision FROM settlement_attempts WHERE note_id=$1`, [noteId]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { noteId: row.noteId as string, note: row.note as string, ack: row.ack as string | null,
      uploadedAt: Number(row.uploadedAt), attempt: row.attempt as PreparedAttempt | null, decision: row.decision as Decision | null };
  }

  async attachAck(noteId: string, ack: string): Promise<void> {
    await this.db.query('UPDATE settlement_attempts SET ack=$2 WHERE note_id=$1 AND ack IS NULL', [noteId, ack]);
  }

  async saveAttempt(noteId: string, attempt: PreparedAttempt): Promise<void> {
    const result = await this.db.query(`UPDATE settlement_attempts SET attempt=$2::jsonb
      WHERE note_id=$1 AND attempt IS NULL AND decision IS NULL RETURNING note_id`, [noteId, JSON.stringify(attempt)]);
    if (result.rows.length !== 1) throw new Error('Attempt already exists or claim is missing');
  }

  async finish(noteId: string, decision: Decision): Promise<Decision> {
    await this.db.query(`UPDATE settlement_attempts SET decision=$2::jsonb
      WHERE note_id=$1 AND attempt IS NOT NULL AND decision IS NULL`, [noteId, JSON.stringify(decision)]);
    const row = await this.get(noteId);
    if (!row?.decision) throw new Error('Decision was not saved');
    return row.decision;
  }
}
