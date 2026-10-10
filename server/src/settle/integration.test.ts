import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { PublicKey, type Connection } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { installSettlement, validateConfirmationPin } from './integration.js';

test('CONF pin checks the actual seed and accepts hex or base58 public pins', () => {
  const pins = JSON.parse(readFileSync(new URL('../../../config/pins.json', import.meta.url), 'utf8'));
  const seed = randomBytes(32); const key = ed25519.getPublicKey(seed);
  expect(() => validateConfirmationPin(pins, seed)).toThrow();
  expect(() => validateConfirmationPin({ serverEd25519PublicKey: base58.encode(key) }, seed)).not.toThrow();
  expect(() => validateConfirmationPin({ serverEd25519PublicKey: Buffer.from(key).toString('hex') }, seed)).not.toThrow();
  expect(() => validateConfirmationPin({ serverEd25519PublicKey: base58.encode(key) }, randomBytes(32))).toThrow('match');
  expect(() => validateConfirmationPin({ serverEd25519PublicKey: 'bad pin' }, seed)).toThrow();
});

test.each([null, base58.encode(new Uint8Array(32).fill(3))])('installSettlement refuses pin %s before migrations or routes', async pin => {
  const seed = randomBytes(32); const query = vi.fn(); const register = vi.fn();
  await expect(installSettlement({ app: { register } as unknown as FastifyInstance,
    database: { query } as unknown as Pool, connection: {} as Connection,
    deployment: { programId: new Uint8Array(32).fill(1), mint: new Uint8Array(32).fill(2), clusterId: 0 },
    feePayer: { publicKey: new PublicKey(new Uint8Array(32).fill(7)), secretKey: new Uint8Array(64) },
    feeBudget: { dailyLamports: '100' }, pins: { serverEd25519PublicKey: pin }, confirmationSeed: seed })).rejects.toThrow();
  expect(query).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
});
