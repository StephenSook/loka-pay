import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { Keypair, type Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import * as P from '@lokapay/protocol';
import { testDatabase } from '../settle/test-database.js';
import { buildApp } from './app.js';
import { policiesFrom, type ShellPins } from './config.js';

// PLAN.md 3.55: the server stores no personal data. This builds the full app with every optional module turned on,
// so every migration runs, then reads information_schema for column names and types that would hold personal data.
// Proven red once with a scratch `payer_phone text` column (see the last test). Runs on CI's Postgres and on PGlite.
export const PERSONAL_NAME = /phone|e_?mail|(^|_)ip(_|$)|ip_?addr|remote_?addr|forwarded|user_?agent|device_?(id|name)|imei|(^|_)mac(_|$)|first_?name|last_?name|full_?name|surname|birth|(^|_)dob(_|$)|street|postal|zip_?code|(^|_)gps(_|$)|latitude|longitude|geo_?loc|contact/i;
export const PERSONAL_TYPES = ['inet', 'cidr', 'macaddr', 'macaddr8'];

const published = JSON.parse(readFileSync(new URL('../../../config/pins.json', import.meta.url), 'utf8')) as ShellPins;
const keys = { tableDemo: Keypair.generate(), publicOnboarding: Keypair.generate(), demo: Keypair.generate(), public: Keypair.generate(), send: Keypair.generate() };
const seed = new Uint8Array(randomBytes(32));
const pins: ShellPins = { ...published, serverEd25519PublicKey: P.toHex(ed25519.getPublicKey(seed)),
  feePayers: { demo: keys.demo.publicKey.toBase58(), public: keys.public.publicKey.toBase58() },
  wallets: { ...published.wallets, tableDemo: keys.tableDemo.publicKey.toBase58(),
    publicOnboarding: keys.publicOnboarding.publicKey.toBase58(), send: keys.send.publicKey.toBase58() } };
const remitPolicy = { capUnits: '1000000', offlineLimitUnits: '1000000', bondUnits: '0', lifetimeSeconds: 86400,
  earmarks: ['11'.repeat(32)], daily: { units: '1000000', funderLamports: '1000000', feeLamports: '1000000' } };

// A stand-in RPC: the slot for health and a 6-decimal mint account so the remittance module installs its tables.
const mintData = Buffer.alloc(82); mintData[44] = 6; mintData[45] = 1;
const connection = { getSlot: async () => 1, getAccountInfo: async () => ({ data: mintData, owner: TOKEN_PROGRAM_ID }) } as unknown as Connection;

let database: Awaited<ReturnType<typeof testDatabase>>;
let remittanceRegistered = false;
beforeAll(async () => {
  database = await testDatabase();
  const app = await buildApp({ database, connection, pins,
    wallets: { team: { funder: keys.tableDemo, feePayer: keys.demo }, public: { funder: keys.publicOnboarding, feePayer: keys.public } },
    certificateSeed: seed, teamKeys: [], policies: policiesFrom({}), noteFeeDailyLamports: '1', commit: 'test', origins: [],
    phase3: { trust: true, reserves: true, remittance: { wallet: keys.send, policy: remitPolicy } } });
  remittanceRegistered = (await app.inject({ url: '/api/health' })).json().phase3Routes['/v1/remittances'].registered;
  await app.close();
});
afterAll(async () => { await database.close(); });

type Column = { table: string; column: string; type: string };
async function columns(): Promise<Column[]> {
  const { rows } = await database.query<Column>(`SELECT table_name AS "table", column_name AS "column", data_type AS "type"
    FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`);
  return rows;
}
const findings = (list: Column[]) => list.filter(c => PERSONAL_NAME.test(c.column) || PERSONAL_TYPES.includes(c.type));

test('no table holds a personal-data column name or an address type (PLAN.md 3.55, D15, D16)', async () => {
  const list = await columns();
  // Every module that keeps state must have migrated, or the scan would silently cover less than the server stores.
  expect(remittanceRegistered).toBe(true);
  const tables = new Set(list.map(c => c.table));
  for (const table of ['settlement_attempts', 'registration_jobs', 'remittance_jobs']) expect(tables, table).toContain(table);
  expect(list.length).toBeGreaterThanOrEqual(5);
  expect(findings(list)).toEqual([]);
});

test('the scan catches a personal-data column: a scratch payer_phone fails it, then is dropped', async () => {
  await database.query('CREATE TABLE privacy_scan_scratch (note_id text, payer_phone text, client inet)');
  try {
    expect(findings(await columns())).toEqual([
      { table: 'privacy_scan_scratch', column: 'payer_phone', type: 'text' },
      { table: 'privacy_scan_scratch', column: 'client', type: 'inet' },
    ]);
  } finally { await database.query('DROP TABLE privacy_scan_scratch'); }
  expect(findings(await columns())).toEqual([]);
});

test('the name pattern flags personal fields and leaves the payment columns alone', () => {
  for (const name of ['payer_phone', 'phone_e164', 'email', 'ip', 'client_ip', 'ip_address', 'remote_addr', 'x_forwarded_for',
    'user_agent', 'device_id', 'first_name', 'date_of_birth', 'street', 'latitude', 'contact_name']) expect(PERSONAL_NAME.test(name), name).toBe(true);
  for (const name of ['note_id', 'key_hash', 'signature', 'recipient', 'allowance_key', 'fee_payer', 'description', 'ship_date',
    'uploaded_at', 'received_at', 'zip', 'skip', 'equipment', 'tips']) expect(PERSONAL_NAME.test(name), name).toBe(false);
});
