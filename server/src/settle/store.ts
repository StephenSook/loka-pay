import { randomUUID } from 'node:crypto';
import { admitSubmission, migrateRateLimit, type AllowanceRateLimit } from './rate-limit.js';
import type { AttemptRow, Claim, Decision, PendingStage, PreparedAttempt } from './types.js';

// Both pg.Pool and PGlite implement this interface. Production must use durable PostgreSQL.
export interface Database {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export class SettlementStore {
  // Production leases use the shared database clock. The override is for deterministic local tests.
  constructor(private readonly db: Database, private readonly clock?: () => number) {}

  async migrate(): Promise<void> {
    await migrateRateLimit(this.db);
    await this.db.query(`CREATE TABLE IF NOT EXISTS settlement_attempts (
      note_id text PRIMARY KEY CHECK (note_id ~ '^[0-9a-f]{64}$'),
      note text NOT NULL, ack text, uploaded_at bigint NOT NULL,
      attempt jsonb, decision jsonb,
      CHECK (decision IS NULL OR attempt IS NOT NULL)
    )`);
    await this.db.query('ALTER TABLE settlement_attempts ADD COLUMN IF NOT EXISTS replacement jsonb');
    await this.db.query('ALTER TABLE settlement_attempts ADD COLUMN IF NOT EXISTS rebuild_claimed boolean NOT NULL DEFAULT false');
    await this.db.query('ALTER TABLE settlement_attempts ADD COLUMN IF NOT EXISTS pending_stage text');
    await this.db.query('ALTER TABLE settlement_attempts ADD COLUMN IF NOT EXISTS failure_stage text');
    await this.db.query('ALTER TABLE settlement_attempts ADD COLUMN IF NOT EXISTS claim_token text');
    await this.db.query('ALTER TABLE settlement_attempts ADD COLUMN IF NOT EXISTS lease_expires_at double precision');
  }

  async limitSubmission(key: string, policy: AllowanceRateLimit): Promise<number | null> {
    return admitSubmission(this.db, key, policy, this.clock?.());
  }

  async claim(row: Claim): Promise<string | null> {
    const token = randomUUID();
    const result = await this.db.query(`INSERT INTO settlement_attempts
      (note_id,note,ack,uploaded_at,claim_token,lease_expires_at)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6::double precision,EXTRACT(EPOCH FROM clock_timestamp()))+30)
      ON CONFLICT (note_id) DO UPDATE SET claim_token=EXCLUDED.claim_token,
        lease_expires_at=EXCLUDED.lease_expires_at, ack=COALESCE(settlement_attempts.ack,EXCLUDED.ack),
        pending_stage=NULL,failure_stage=NULL
      WHERE settlement_attempts.attempt IS NULL AND settlement_attempts.decision IS NULL
        AND COALESCE(settlement_attempts.lease_expires_at,0)<=EXCLUDED.lease_expires_at-30
      RETURNING note_id`, [row.noteId, row.note, row.ack, row.uploadedAt, token, this.clock?.() ?? null]);
    return result.rows.length === 1 ? token : null;
  }

  async get(noteId: string): Promise<AttemptRow | null> {
    const result = await this.db.query(`SELECT note_id AS "noteId", note, ack,
      uploaded_at::text AS "uploadedAt", attempt, decision, replacement, rebuild_claimed AS "rebuildClaimed"
      FROM settlement_attempts WHERE note_id=$1`, [noteId]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { noteId: row.noteId as string, note: row.note as string, ack: row.ack as string | null,
      uploadedAt: Number(row.uploadedAt), attempt: row.attempt as PreparedAttempt | null, decision: row.decision as Decision | null,
      replacement: row.replacement as PreparedAttempt | null, rebuildClaimed: row.rebuildClaimed as boolean };
  }

  async attachAck(noteId: string, ack: string): Promise<void> {
    await this.db.query('UPDATE settlement_attempts SET ack=$2 WHERE note_id=$1 AND ack IS NULL', [noteId, ack]);
  }

  async saveAttempt(noteId: string, attempt: PreparedAttempt, token: string): Promise<boolean> {
    const result = await this.db.query(`UPDATE settlement_attempts SET attempt=$2::jsonb
      WHERE note_id=$1 AND attempt IS NULL AND decision IS NULL AND claim_token=$3
        AND lease_expires_at>COALESCE($4::double precision,EXTRACT(EPOCH FROM clock_timestamp()))
      RETURNING note_id`, [noteId, JSON.stringify(attempt), token, this.clock?.() ?? null]);
    return result.rows.length === 1;
  }

  async finish(noteId: string, decision: Decision): Promise<Decision> {
    await this.db.query(`UPDATE settlement_attempts SET decision=$2::jsonb,pending_stage=NULL,failure_stage=NULL
      WHERE note_id=$1 AND attempt IS NOT NULL AND (decision IS NULL
        OR ($2::jsonb->>'signature'=attempt->>'signature' AND decision->>'signature'<>attempt->>'signature'))`,
    [noteId, JSON.stringify(decision)]);
    const row = await this.get(noteId);
    if (!row?.decision) throw new Error('Decision was not saved');
    return row.decision;
  }

  async claimRebuild(noteId: string, originalSignature: string): Promise<boolean> {
    const result = await this.db.query(`UPDATE settlement_attempts SET rebuild_claimed=true
      WHERE note_id=$1 AND attempt->>'signature'=$2 AND NOT rebuild_claimed AND decision IS NULL RETURNING note_id`,
    [noteId, originalSignature]);
    return result.rows.length === 1;
  }

  async saveReplacement(noteId: string, attempt: PreparedAttempt): Promise<void> {
    const result = await this.db.query(`UPDATE settlement_attempts SET replacement=$2::jsonb
      WHERE note_id=$1 AND rebuild_claimed AND replacement IS NULL AND decision IS NULL
        AND attempt->>'signature'<>$2::jsonb->>'signature' RETURNING note_id`, [noteId, JSON.stringify(attempt)]);
    if (result.rows.length !== 1) throw new Error('Replacement was not saved');
  }

  async markPending(noteId: string, stage: PendingStage, failed: boolean): Promise<void> {
    // Fixed stage names only. Never persist exception text, RPC payloads or caller input here.
    await this.db.query(`UPDATE settlement_attempts SET pending_stage=$2,
      failure_stage=CASE WHEN $3::boolean THEN $2 ELSE failure_stage END
      WHERE note_id=$1 AND decision IS NULL`, [noteId, stage, failed]);
  }
}
