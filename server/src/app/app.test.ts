import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Keypair, type Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import * as P from '@lokapay/protocol';
import { testDatabase } from '../settle/test-database.js';
import { buildApp, privateLogger, type ShellOptions } from './app.js';
import { ed25519Seed, loadConfig, policiesFrom, type ShellPins } from './config.js';

// No VPS key is read here: every key is generated per run, and the RPC is a stand-in that never contacts Solana.
const published = JSON.parse(readFileSync(new URL('../../../config/pins.json', import.meta.url), 'utf8')) as ShellPins;
const keypairs = { tableDemo: Keypair.generate(), publicOnboarding: Keypair.generate(), demo: Keypair.generate(), public: Keypair.generate() };
const seed = new Uint8Array(randomBytes(32));
const pins: ShellPins = { ...published, serverEd25519PublicKey: P.toHex(ed25519.getPublicKey(seed)),
  feePayers: { demo: keypairs.demo.publicKey.toBase58(), public: keypairs.public.publicKey.toBase58() },
  wallets: { ...published.wallets, tableDemo: keypairs.tableDemo.publicKey.toBase58(), publicOnboarding: keypairs.publicOnboarding.publicKey.toBase58() } };
const wallets = { team: { funder: keypairs.tableDemo, feePayer: keypairs.demo }, public: { funder: keypairs.publicOnboarding, feePayer: keypairs.public } };
const rpc = (getSlot: () => Promise<number>) => ({ getSlot }) as unknown as Connection;

let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { database = await testDatabase(); });
afterAll(async () => { await database.close(); });

function options(overrides: Partial<ShellOptions> = {}): ShellOptions {
  return { database, connection: rpc(async () => 412345678), pins, wallets, certificateSeed: seed, teamKeys: [],
    policies: policiesFrom({}), noteFeeDailyLamports: '200000000', commit: 'abc1234', origins: ['https://zerobars.us'], ...overrides };
}

describe('GET /api/health (API-V1 section 6)', () => {
  test('reads the slot live and reports the commit and program', async () => {
    let calls = 0;
    const app = await buildApp(options({ connection: rpc(async () => 1000 + ++calls) }));
    const first = await app.inject({ url: '/api/health' });
    const second = await app.inject({ url: '/api/health' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ ok: true, commit: 'abc1234', cluster: 'devnet', programId: pins.programId, slot: 1001 });
    expect(second.json().slot).toBe(1002);
    await app.close();
  });

  test('answers 503 with ok false when the RPC cannot be reached', async () => {
    const app = await buildApp(options({ connection: rpc(async () => { throw new Error('rpc down'); }) }));
    const response = await app.inject({ url: '/api/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ ok: false, commit: 'abc1234', cluster: 'devnet', programId: pins.programId, slot: null });
    await app.close();
  });
});

describe('startup fails closed', () => {
  test('a signing seed that does not match the published key never starts', async () => {
    await expect(buildApp(options({ certificateSeed: new Uint8Array(randomBytes(32)) }))).rejects.toThrow('Certificate signer');
  });
  test('an unpublished server key never starts', async () => {
    await expect(buildApp(options({ pins: { ...pins, serverEd25519PublicKey: null } }))).rejects.toThrow('Publish');
  });
  test('swapped team and public wallets never start', async () => {
    await expect(buildApp(options({ wallets: { team: wallets.public, public: wallets.team } }))).rejects.toThrow('signer');
  });
});

describe('routing, CORS and the burst guard', () => {
  test('mounts the registration and note routes, and names unknown routes', async () => {
    const app = await buildApp(options());
    for (const url of ['/v1/payers', '/v1/merchants', '/v1/notes']) {
      const response = await app.inject({ method: 'POST', url, payload: {} });
      expect(response.statusCode, url).not.toBe(404);
      expect(response.statusCode, url).toBeLessThan(500);
    }
    const missing = await app.inject({ url: '/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('unknown_route');
    await app.close();
  });

  test('allows only the listed web origins', async () => {
    const app = await buildApp(options());
    const ours = await app.inject({ url: '/api/health', headers: { origin: 'https://zerobars.us' } });
    expect(ours.headers['access-control-allow-origin']).toBe('https://zerobars.us');
    const theirs = await app.inject({ url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(theirs.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await app.inject({ method: 'OPTIONS', url: '/v1/notes', headers: { origin: 'https://zerobars.us' } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toContain('POST');
    await app.close();
  });

  test('answers 429 with retry-after past the burst limit, per client', async () => {
    const app = await buildApp(options({ burstLimit: 3 }));
    const from = (ip: string) => app.inject({ url: '/api/health', remoteAddress: ip });
    for (let i = 0; i < 3; i++) expect((await from('198.51.100.1')).statusCode).toBe(200);
    const limited = await from('198.51.100.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect((await from('198.51.100.2')).statusCode).toBe(200);
    await app.close();
  });
});

test('logs carry no IP, forwarded address, user agent or body value (PLAN.md 3.55)', async () => {
  const lines: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, done) { lines.push(String(chunk)); done(); } });
  const app = await buildApp(options({ logger: privateLogger(stream) }));
  const planted = ['203.0.113.77', '198.51.100.99', 'planted-agent/9.9', 'planted-body-value-7f3a'];
  await app.inject({ method: 'POST', url: '/v1/payers', remoteAddress: planted[1],
    headers: { 'x-forwarded-for': planted[0], 'user-agent': planted[2] }, payload: { publicKey: planted[3] } });
  await app.inject({ url: '/api/health', remoteAddress: planted[1], headers: { 'user-agent': planted[2] } });
  await app.close();
  const log = lines.join('');
  for (const value of planted) expect(log, value).not.toContain(value);
  expect(log).toContain('"route":"/v1/payers"');
  expect(log).toContain('"route":"/api/health"');
});

describe('loadConfig', () => {
  test('reads the VPS key layout and derives the published Ed25519 key from the PEM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loka-keys-'));
    try {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      writeFileSync(join(dir, 'server-ed25519.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
      const names = { 'funding-table-demo': keypairs.tableDemo, 'fee-payer-demo': keypairs.demo,
        'funding-public-onboarding': keypairs.publicOnboarding, 'fee-payer-public': keypairs.public };
      for (const [name, pair] of Object.entries(names)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(Array.from(pair.secretKey)));
      const config = loadConfig({ DATABASE_URL: 'postgres://localhost/x', KEYS_DIR: dir, TEAM_KEY_HASHES: 'ab'.repeat(32) });
      const raw = new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
      expect(P.equalBytes(ed25519.getPublicKey(config.certificateSeed), raw)).toBe(true);
      expect(config.wallets.team.funder.publicKey.equals(keypairs.tableDemo.publicKey)).toBe(true);
      expect(config.wallets.public.feePayer.publicKey.equals(keypairs.public.publicKey)).toBe(true);
      expect(config.teamKeys).toEqual(['ab'.repeat(32)]);
      expect(config.commit).toBe('uncommitted');
      expect(config.noteFeeDailyLamports).toBe('200000000');
      expect(config.pins.programId).toBe(published.programId);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('refuses to start without a database or with a non-Ed25519 signing key', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    expect(() => ed25519Seed(String(privateKey.export({ format: 'pem', type: 'pkcs8' })))).toThrow('not Ed25519');
  });
});

test('missing Phase 3 config leaves routes unregistered and names each unavailable route in health', async () => {
  const app = await buildApp(options());
  try {
    const health = (await app.inject('/api/health')).json();
    for (const url of ['/api/volume', '/trust', '/v1/remittances', '/api/reserves']) {
      expect(health.phase3Routes[url]).toEqual({ registered: false, reason: 'missing_config' });
      expect((await app.inject({ method: url === '/v1/remittances' ? 'POST' : 'GET', url, ...(url === '/v1/remittances' ? { payload: {} } : {}) })).statusCode).toBe(404);
    }
  } finally { await app.close(); }
});

test('configured Phase 3 modules boot, inherit safe logging and fail closed on unavailable live evidence', async () => {
  const send = Keypair.generate(); const mintData = Buffer.alloc(82); mintData[44] = 6; mintData[45] = 1;
  const connection = { getSlot: async () => 1, getAccountInfo: async () => ({ data: mintData, owner: TOKEN_PROGRAM_ID }) } as unknown as Connection;
  const lines: string[] = []; const stream = new Writable({ write(chunk, _encoding, done) { lines.push(String(chunk)); done(); } });
  const app = await buildApp(options({ connection, logger: privateLogger(stream), pins: { ...pins, wallets: { ...pins.wallets, send: send.publicKey.toBase58() } },
    phase3: { volume: { measurementPath: 'missing-evidence' }, trust: true, reserves: true,
      remittance: { wallet: send, policy: { capUnits: '1', offlineLimitUnits: '1', bondUnits: '0', lifetimeSeconds: 60,
        earmarks: ['ab'.repeat(32)], daily: { units: '1', funderLamports: '1', feeLamports: '1' } } } } }));
  try {
    const health = (await app.inject('/api/health')).json();
    for (const url of ['/api/volume', '/trust', '/api/reserves']) {
      expect(health.phase3Routes[url]).toEqual({ registered: true, reason: null });
      const response = await app.inject(url); expect(response.statusCode).toBe(503);
      expect(response.json().error).not.toBe('unknown_route');
    }
    expect(health.phase3Routes['/v1/remittances']).toEqual({ registered: true, reason: null });
    expect((await app.inject({ method: 'POST', url: '/v1/remittances', payload: { recipientAllowanceId: 'planted-secret' },
      remoteAddress: '203.0.113.77' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/reserves', payload: {} })).statusCode).toBe(404);
  } finally { await app.close(); }
  expect(lines.join('')).not.toContain('planted-secret'); expect(lines.join('')).not.toContain('203.0.113.77');
  for (const line of lines) expect(Object.keys(JSON.parse(line)).sort()).toEqual(['level', 'method', 'route', 'status']);
});

test('an optional send wallet mismatch does not prevent the core app from booting', async () => {
  const app = await buildApp(options({ pins: { ...pins, wallets: { ...pins.wallets, send: Keypair.generate().publicKey.toBase58() } },
    phase3: { remittance: { wallet: wallets.team.funder, policy: { capUnits: '1', offlineLimitUnits: '1', bondUnits: '0',
      lifetimeSeconds: 60, earmarks: ['ab'.repeat(32)], daily: { units: '1', funderLamports: '1', feeLamports: '1' } } } } }));
  try {
    const health = await app.inject('/api/health'); expect(health.statusCode).toBe(200);
    expect(health.json().phase3Routes['/v1/remittances']).toEqual({ registered: false, reason: 'initialization_failed' });
    expect((await app.inject({ method: 'POST', url: '/v1/remittances', payload: {} })).statusCode).toBe(404);
  } finally { await app.close(); }
});
