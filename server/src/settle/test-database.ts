import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import type { Database } from './store.js';

// CI already provides localhost/loka_test. Each test gets an isolated schema and its own pool.
// Locally, PGlite runs the same SQL without a daemon. Neither path contacts Solana.
export async function testDatabase(): Promise<Database & { close(): Promise<void> }> {
  if (!process.env.DATABASE_URL) return new PGlite();
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/loka_test') {
    throw new Error('Settlement tests only accept DATABASE_URL pointing to localhost/loka_test');
  }
  const schema = `settle_test_${randomBytes(8).toString('hex')}`;
  const pool = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
  try {
    await pool.query(`CREATE SCHEMA ${schema}`);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    query: (sql, params) => pool.query(sql, params),
    close: async () => {
      try {
        if (!/^settle_test_[0-9a-f]{16}$/.test(schema)) throw new Error('Unexpected test schema');
        await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally { await pool.end(); }
    },
  };
}
