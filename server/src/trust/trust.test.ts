import { createHash } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { Keypair, PublicKey, type Connection } from '@solana/web3.js';
import { readTrust } from './index.js';

function fixture(immutable = false) {
  const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const program = Keypair.generate().publicKey, authority = Keypair.generate().publicKey;
  const address = PublicKey.findProgramAddressSync([program.toBuffer()], loader)[0];
  const programBytes = Buffer.alloc(36); programBytes.writeUInt32LE(2); address.toBuffer().copy(programBytes, 4);
  const dataBytes = Buffer.alloc(50); dataBytes.writeUInt32LE(3); dataBytes.writeBigUInt64LE(123n, 4); dataBytes[12] = immutable ? 0 : 1;
  if (!immutable) authority.toBuffer().copy(dataBytes, 13); dataBytes.set([1, 2, 3, 0, 0], 45);
  const info = { data: programBytes, owner: loader, executable: true, lamports: 1, rentEpoch: 1 };
  const data = { ...info, data: dataBytes, executable: false };
  const rpc = { getAccountInfoAndContext: vi.fn(async () => ({ context: { slot: 1 }, value: info })),
    getMultipleAccountsInfoAndContext: vi.fn(async () => ({ context: { slot: 2 }, value: [info, data] })) };
  const pins = { cluster: 'devnet', programId: program.toBase58(), upgradeAuthority: immutable ? null : authority.toBase58(),
    programDataSha256: createHash('sha256').update(dataBytes.subarray(45)).digest('hex') };
  return { rpc, pins, data, address };
}
test.each([false, true])('reads live authority and exact payload hash in one snapshot, immutable=%s', async immutable => {
  const f = fixture(immutable), result = await readTrust(f.rpc as unknown as Connection, f.pins);
  expect(result.authorityMatches).toBe(true); expect(result.hashMatches).toBe(true); expect(result.slot).toBe(2);
  expect(f.rpc.getMultipleAccountsInfoAndContext).toHaveBeenCalledWith([new PublicKey(f.pins.programId), f.address], { commitment: 'confirmed', minContextSlot: 1 });
});
test('missing recorded hash yields no match verdict and malformed owner fails closed', async () => {
  const f = fixture(); expect((await readTrust(f.rpc as unknown as Connection, { ...f.pins, programDataSha256: null })).hashMatches).toBeNull();
  f.data.owner = Keypair.generate().publicKey;
  await expect(readTrust(f.rpc as unknown as Connection, f.pins)).rejects.toThrow('Invalid ProgramData');
});
test('a live authority or program upgrade reports a mismatch', async () => {
  const f = fixture(); f.data.data[45] ^= 1;
  const result = await readTrust(f.rpc as unknown as Connection, { ...f.pins, upgradeAuthority: Keypair.generate().publicKey.toBase58() });
  expect(result.hashMatches).toBe(false); expect(result.authorityMatches).toBe(false);
});
