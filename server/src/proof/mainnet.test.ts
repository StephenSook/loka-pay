import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { base58 } from '@scure/base';
import { Keypair, VersionedTransaction, type Connection } from '@solana/web3.js';
import * as P from '@lokapay/protocol';
import { buildMainnetProof, runMainnetProof } from './mainnet.js';

const vectors = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8')) as {
  notes: { name: string; wireHex: string; precompileDataHex: string; highSTwinSignatureHex: string }[];
};
test.each(vectors.notes)('published $name builds exactly one precompile over the unmodified note', (vector: { wireHex: string; precompileDataHex: string }) => {
  const tx = buildMainnetProof(P.fromHex(vector.wireHex));
  expect(tx.instructions).toHaveLength(1);
  expect(tx.instructions[0].programId.toBase58()).toBe(P.SECP256R1_PROGRAM_ID);
  expect(tx.instructions[0].keys).toEqual([]);
  expect(tx.instructions[0].data.toString('hex')).toBe(vector.precompileDataHex);
});
test('published high-S twin, truncation and a tampered note are refused before RPC access', () => {
  const wire = P.fromHex(vectors.notes[0].wireHex);
  const high = wire.slice(); high.set(P.fromHex(vectors.notes[0].highSTwinSignatureHex), 141);
  expect(() => buildMainnetProof(high)).toThrow('high_s');
  expect(() => buildMainnetProof(wire.slice(0, -1))).toThrow('length');
  wire[121] ^= 1; expect(() => buildMainnetProof(wire)).toThrow('bad_signature');
});
function fixture() {
  const feePayer = Keypair.generate();
  const rpc = { getGenesisHash: vi.fn(async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 })),
    simulateTransaction: vi.fn(async (_tx: VersionedTransaction, _config: unknown) => ({ value: { err: null as unknown, logs: ['mock precompile'], unitsConsumed: 0 } })),
    sendRawTransaction: vi.fn(async (bytes: Uint8Array, _config: unknown) => base58.encode(VersionedTransaction.deserialize(bytes).signatures[0])) };
  const print = vi.fn();
  return { rpc, print, options: { connection: rpc as unknown as Connection, feePayer, wire: P.fromHex(vectors.notes[0].wireHex), print } };
}
test('default execution only simulates and prints the simulation result', async () => {
  const f = fixture(); await runMainnetProof(f.options);
  expect(f.rpc.simulateTransaction).toHaveBeenCalledWith(expect.any(VersionedTransaction), { sigVerify: true, commitment: 'confirmed' });
  expect(f.print).toHaveBeenCalledWith(expect.objectContaining({ simulation: expect.objectContaining({ err: null }) }));
  expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
});
test('explicit send is simulated first, sends once with preflight and prints its mainnet explorer link', async () => {
  const f = fixture(); const result = await runMainnetProof({ ...f.options, send: true });
  expect(f.rpc.simulateTransaction.mock.invocationCallOrder[0]).toBeLessThan(f.rpc.sendRawTransaction.mock.invocationCallOrder[0]);
  expect(f.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  expect(f.rpc.sendRawTransaction.mock.calls[0][1]).toEqual({ skipPreflight: false, maxRetries: 0 });
  expect(result).toMatchObject({ signature: expect.any(String), explorer: expect.stringMatching(/^https:\/\/explorer.solana.com\/tx\//) });
  expect(result!.explorer).not.toContain('devnet');
});
test('simulation failure or a non-mainnet RPC never broadcasts', async () => {
  const f = fixture(); f.rpc.simulateTransaction.mockResolvedValueOnce({ value: { err: 'simulation failure', logs: [], unitsConsumed: 0 } });
  await expect(runMainnetProof({ ...f.options, send: true })).rejects.toThrow('Simulation failed');
  expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  f.rpc.getGenesisHash.mockResolvedValueOnce('not-mainnet');
  await expect(runMainnetProof({ ...f.options, send: true })).rejects.toThrow('not mainnet');
  expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
});
