import { expect, test, vi } from 'vitest';
import { Keypair, type Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import type { FastifyInstance } from 'fastify';
import * as P from '@lokapay/protocol';
import { installRemittance, validateSendWallet } from './remittance-integration.js';
import { buildRegistrationTransaction } from './transaction.js';
import type { RegistrationPlan } from './types.js';

test('remittance cannot use either onboarding wallet or either settlement fee payer', () => {
  const send = Keypair.generate(), table = Keypair.generate(), publicWallet = Keypair.generate();
  const pins = { wallets: { send: send.publicKey.toBase58(), tableDemo: table.publicKey.toBase58(), publicOnboarding: publicWallet.publicKey.toBase58() },
    feePayers: { demo: Keypair.generate().publicKey.toBase58(), public: Keypair.generate().publicKey.toBase58() } };
  expect(() => validateSendWallet(pins, send)).not.toThrow();
  expect(() => validateSendWallet(pins, table)).toThrow();
  expect(() => validateSendWallet({ ...pins, wallets: { ...pins.wallets, send: pins.wallets.tableDemo } }, table)).toThrow();
  const plan: RegistrationPlan = { kind: 'payer', pool: 'public', publicKey: 'Ag' + 'A'.repeat(42), keyHash: '00'.repeat(32), allowanceId: '1', expiry: 1,
    policy: { capUnits: '1', offlineLimitUnits: '1', bondUnits: '0', lifetimeSeconds: 1, earmarks: ['ab'.repeat(32)], daily: { units: '1', funderLamports: '1', feeLamports: '1' } } };
  const tx = buildRegistrationTransaction({ programId: Keypair.generate().publicKey.toBytes(), mint: Keypair.generate().publicKey.toBytes(), clusterId: 0 },
    { team: { funder: send, feePayer: send }, public: { funder: send, feePayer: send } }, plan);
  expect(tx.feePayer?.equals(send.publicKey)).toBe(true); expect(tx.instructions[0].keys[0].pubkey.equals(send.publicKey)).toBe(true);
  expect(tx.instructions[0].keys.some(key => key.pubkey.equals(table.publicKey) || key.pubkey.equals(publicWallet.publicKey))).toBe(false);
});
test('wrong mint decimals fail startup before database access or route installation', async () => {
  const wallet = Keypair.generate(), program = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const seed = new Uint8Array(32).fill(1), data = Buffer.alloc(82); data[44] = 9; data[45] = 1;
  const rpc = { getAccountInfo: vi.fn(async () => ({ data, owner: TOKEN_PROGRAM_ID })) };
  const database = { query: vi.fn(async () => ({ rows: [] })) }, app = { post: vi.fn() };
  const pins = { cluster: 'devnet', programId: program.toBase58(), mint: mint.toBase58(), serverEd25519PublicKey: P.toHex(ed25519.getPublicKey(seed)),
    wallets: { send: wallet.publicKey.toBase58(), tableDemo: Keypair.generate().publicKey.toBase58(), publicOnboarding: Keypair.generate().publicKey.toBase58() },
    feePayers: { demo: Keypair.generate().publicKey.toBase58(), public: Keypair.generate().publicKey.toBase58() } };
  await expect(installRemittance({ app: app as unknown as FastifyInstance, database, connection: rpc as unknown as Connection,
    deployment: { programId: program.toBytes(), mint: mint.toBytes(), clusterId: 0 }, wallet, certificateSeed: seed, pins,
    policy: { capUnits: '1', offlineLimitUnits: '1', bondUnits: '0', lifetimeSeconds: 60, earmarks: ['ab'.repeat(32)], daily: { units: '1', funderLamports: '1', feeLamports: '1' } } })).rejects.toThrow('six-decimal');
  expect(database.query).not.toHaveBeenCalled(); expect(app.post).not.toHaveBeenCalled();
});
