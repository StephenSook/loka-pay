import { createHash } from 'node:crypto';
import { PublicKey, type AccountInfo, type Connection } from '@solana/web3.js';
import type { FastifyInstance } from 'fastify';

const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
export interface TrustPins { cluster: string; programId: string; upgradeAuthority: string | null; programDataSha256?: string | null }
function programDataAddress(info: AccountInfo<Buffer> | null): PublicKey {
  if (!info || !info.executable || !info.owner.equals(loader) || info.data.length !== 36 || info.data.readUInt32LE(0) !== 2) throw new Error('Not an upgradeable executable program');
  return new PublicKey(info.data.subarray(4, 36));
}
export async function readTrust(connection: Pick<Connection, 'getAccountInfoAndContext' | 'getMultipleAccountsInfoAndContext'>, pins: TrustPins) {
  if (pins.cluster !== 'devnet') throw new Error('Trust reader is devnet only');
  if (pins.programDataSha256 && !/^[a-f0-9]{64}$/.test(pins.programDataSha256)) throw new Error('Invalid recorded program-data hash');
  const program = new PublicKey(pins.programId);
  const discovered = await connection.getAccountInfoAndContext(program, 'confirmed');
  const address = programDataAddress(discovered.value);
  if (!address.equals(PublicKey.findProgramAddressSync([program.toBuffer()], loader)[0])) throw new Error('ProgramData pointer does not match loader PDA');
  const snapshot = await connection.getMultipleAccountsInfoAndContext([program, address], { commitment: 'confirmed', minContextSlot: discovered.context.slot });
  if (snapshot.context.slot < discovered.context.slot) throw new Error('RPC did not honor discovery slot');
  if (!programDataAddress(snapshot.value[0]).equals(address)) throw new Error('ProgramData pointer changed');
  const data = snapshot.value[1];
  if (!data || !data.owner.equals(loader) || data.executable || data.data.length <= 45 || data.data.readUInt32LE(0) !== 3 || ![0, 1].includes(data.data[12])) throw new Error('Invalid ProgramData account');
  const upgradeAuthority = data.data[12] === 0 ? null : new PublicKey(data.data.subarray(13, 45)).toBase58();
  const programHash = createHash('sha256').update(data.data.subarray(45)).digest('hex');
  return { cluster: 'devnet', programId: pins.programId, programData: address.toBase58(), slot: snapshot.context.slot,
    observedAt: new Date().toISOString(), hashDefinition: 'SHA-256 of all ProgramData bytes after the 45-byte loader header, including allocation padding. This alone is not a reproducible-build verdict.',
    live: { upgradeAuthority, programHash }, recorded: { upgradeAuthority: pins.upgradeAuthority, programHash: pins.programDataSha256 ?? null },
    authorityMatches: upgradeAuthority === pins.upgradeAuthority, hashMatches: pins.programDataSha256 ? programHash === pins.programDataSha256 : null };
}
export function registerTrustRoutes(app: FastifyInstance, connection: Connection, pins: TrustPins): void {
  app.get('/trust', async (_request, reply) => {
    try { return await readTrust(connection, pins); }
    catch { return reply.code(503).send({ error: 'trust_unavailable', message: 'Live program data could not be verified. No trust verdict.' }); }
  });
}
