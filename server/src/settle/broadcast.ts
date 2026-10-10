import { randomUUID } from 'node:crypto';
import type { Database } from './store.js';
import type { PreparedAttempt } from './types.js';

// Only exact saved bytes can be resent. There are at most three broadcast admissions per signature.
export class BroadcastLease {
  constructor(private readonly db: Database, private readonly clock?: () => number) {}
  async migrate(): Promise<void> {
    await this.db.query(`CREATE TABLE IF NOT EXISTS saved_broadcasts (
      operation text NOT NULL, signature text NOT NULL, token text NOT NULL,
      lease_expires_at double precision NOT NULL, sends integer NOT NULL,
      PRIMARY KEY(operation,signature))`);
  }
  async send(operation: string, attempt: PreparedAttempt, send: (attempt: PreparedAttempt) => Promise<void>): Promise<boolean> {
    const token = randomUUID();
    const { rows } = await this.db.query(`INSERT INTO saved_broadcasts(operation,signature,token,lease_expires_at,sends)
      VALUES($1,$2,$3,COALESCE($4::double precision,EXTRACT(EPOCH FROM clock_timestamp()))+30,1)
      ON CONFLICT(operation,signature) DO UPDATE SET token=EXCLUDED.token,
        lease_expires_at=EXCLUDED.lease_expires_at,sends=saved_broadcasts.sends+1
      WHERE saved_broadcasts.lease_expires_at<=EXCLUDED.lease_expires_at-30 AND saved_broadcasts.sends<3
      RETURNING token`, [operation, attempt.signature, token, this.clock?.() ?? null]);
    if (!rows.length) return false;
    const active = await this.db.query(`SELECT token FROM saved_broadcasts WHERE operation=$1 AND signature=$2
      AND token=$3 AND lease_expires_at>COALESCE($4::double precision,EXTRACT(EPOCH FROM clock_timestamp()))`,
    [operation, attempt.signature, token, this.clock?.() ?? null]);
    if (!active.rows.length) return false;
    await send(attempt);
    return true;
  }
}
