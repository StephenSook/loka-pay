import { afterEach, expect, test, vi } from 'vitest';
import { BroadcastLease } from './broadcast.js';
import { testDatabase } from './test-database.js';
import type { Database } from './store.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });

test('broadcast ownership fences a paused worker before sending', async () => {
  const db = await testDatabase(); closers.push(() => db.close());
  let now = 100; let release!: () => void; let reached!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { reached = resolve; });
  let pause = true;
  const paused: Database = { async query<T extends Record<string, unknown>>(sql: string, args?: unknown[]) {
    if (pause && sql.startsWith('SELECT token')) { pause = false; reached(); await barrier; }
    return db.query<T>(sql, args);
  } };
  const old = new BroadcastLease(paused, () => now); await old.migrate();
  const next = new BroadcastLease(db, () => now);
  const attempt = { signature: 'saved', rawTransaction: 'identical', blockhash: 'hash', lastValidBlockHeight: 100 };
  const oldSend = vi.fn(async () => {}); const nextSend = vi.fn(async () => {});
  const running = old.send('job', attempt, oldSend); await ready;
  now = 130; expect(await next.send('job', attempt, nextSend)).toBe(true);
  release(); expect(await running).toBe(false);
  expect(oldSend).not.toHaveBeenCalled(); expect(nextSend).toHaveBeenCalledOnce();
});
