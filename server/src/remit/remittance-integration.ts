import { readFileSync } from 'node:fs';
import anchor from '@anchor-lang/core';
import { p256 } from '@noble/curves/nist.js';
import { base58 } from '@scure/base';
import { getMint } from '@solana/spl-token';
import { Connection, PublicKey, type Signer } from '@solana/web3.js';
import type { FastifyInstance } from 'fastify';
import * as P from '@lokapay/protocol';
import { certificateSigner } from '../certs/signing.js';
import { validateConfirmationPin } from '../settle/integration.js';
import { HttpError } from '../settle/validation.js';
import type { Database } from '../settle/store.js';
import type { PreparedAttempt } from '../settle/types.js';
import { RegistrationGateway } from './transaction.js';
import { RemittanceService, RemittanceStore } from './remittance.js';
import type { Policy } from './types.js';

const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
export class RemittanceGateway extends RegistrationGateway {
  constructor(private readonly rpc: Connection, private readonly deploy: P.Deployment, wallet: Signer) {
    // This gateway's two internal routing labels both point to the separate send wallet.
    // Neither registration pool's wallet is supplied to the gateway.
    super(rpc, deploy, { team: { funder: wallet, feePayer: wallet }, public: { funder: wallet, feePayer: wallet } });
  }
  async recipient(id: string): Promise<{ publicKey: string }> {
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(id));
    const program = new PublicKey(this.deploy.programId);
    const address = PublicKey.findProgramAddressSync([Buffer.from('allowance'), bytes], program)[0];
    const record = await this.rpc.getAccountInfo(address, 'confirmed');
    if (!record || !record.owner.equals(program)) throw new HttpError(422, 'unknown_allowance');
    const allowance = new anchor.BorshAccountsCoder(idl).decode('Allowance', record.data);
    if (allowance.id.toString() !== id) throw new HttpError(422, 'unknown_allowance');
    const key = Uint8Array.from(allowance.payer_key);
    p256.Point.fromBytes(key);
    return { publicKey: P.base64urlEncode(key) };
  }
  override async send(attempt: PreparedAttempt): Promise<void> {
    const signature = await this.rpc.sendRawTransaction(Buffer.from(attempt.rawTransaction, 'base64'), { skipPreflight: false, maxRetries: 0 });
    if (signature !== attempt.signature) throw new Error('Unexpected remittance signature');
  }
}
export function validateSendWallet(pins: { wallets: { send: string; tableDemo: string; publicOnboarding: string }; feePayers: { demo: string; public: string } }, wallet: Signer): void {
  if (wallet.publicKey.toBase58() !== pins.wallets.send || [pins.wallets.tableDemo, pins.wallets.publicOnboarding, pins.feePayers.demo, pins.feePayers.public].includes(pins.wallets.send)) throw new Error('Remittance requires the separately pinned send wallet');
}
export async function installRemittance(options: {
  app: FastifyInstance; database: Database; connection: Connection; deployment: P.Deployment; wallet: Signer; certificateSeed: Uint8Array;
  pins: { cluster: string; programId: string; mint: string; serverEd25519PublicKey: string | null;
    wallets: { send: string; tableDemo: string; publicOnboarding: string }; feePayers: { demo: string; public: string } }; policy: Policy;
}): Promise<RemittanceService> {
  if (options.pins.cluster !== 'devnet' || options.deployment.clusterId !== 0 || base58.encode(options.deployment.programId) !== options.pins.programId
    || base58.encode(options.deployment.mint) !== options.pins.mint) throw new Error('Remittance deployment must match devnet pins');
  validateSendWallet(options.pins, options.wallet); validateConfirmationPin(options.pins, options.certificateSeed);
  const mint = await getMint(options.connection, new PublicKey(options.pins.mint), 'confirmed');
  if (mint.decimals !== 6) throw new Error('Send cap requires the pinned six-decimal sandbox USDC mint');
  const store = new RemittanceStore(options.database, `${options.pins.programId}:${options.pins.mint}:devnet:send`, undefined,
    `send:${options.wallet.publicKey.toBase58()}`); await store.migrate();
  const service = new RemittanceService({ store, chain: new RemittanceGateway(options.connection, options.deployment, options.wallet),
    signer: certificateSigner(options.deployment, options.certificateSeed), policy: options.policy });
  options.app.post('/v1/remittances', { bodyLimit: 4096 }, async (request, reply) => {
    try { const result = await service.submit(request.body, request.ip); return reply.code(result.statusCode).send(result.body); }
    catch (error) {
      if (error instanceof HttpError) {
        if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
        return reply.code(error.statusCode).send({ error: error.code, message: error.code === 'amount_cap' ? 'Send at most one sandbox USDC.' : error.message });
      }
      return reply.code(503).send({ error: 'chain_unavailable' });
    }
  });
  return service;
}
