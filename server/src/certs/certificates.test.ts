import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import * as P from '@lokapay/protocol';
import { certificateSigner } from './signing.js';

const vectors = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
const deployment = { programId: P.fromHex(vectors.constants.programIdHex), clusterId: 0, mint: P.fromHex(vectors.constants.mintHex) };
const publicKey = P.fromHex(vectors.keys.serverEd25519.publicKeyHex);
const seed = new Uint8Array(createHash('sha256').update(vectors.keys.serverEd25519.label).digest());
const signer = certificateSigner(deployment, seed);

for (const kind of ['allowance', 'merchant'] as const) {
  const samples = kind === 'allowance' ? vectors.allowances : vectors.merchants;
  const verify = (wire: Uint8Array, target = deployment, key = publicKey) => kind === 'allowance'
    ? P.verifyAllowWire(wire, target, key) : P.verifyMerchWire(wire, target, key);
  test(`${kind} certificates match every published vector byte for byte`, async () => {
    for (const sample of samples) {
      const f = sample.fields;
      const actual = kind === 'allowance' ? await signer.allow({ allowanceId: BigInt(f.allowanceId),
        payerKeyHash: P.fromHex(f.payerKeyHashHex), cap: BigInt(f.cap), offlineLimit: BigInt(f.offlineLimit),
        bond: BigInt(f.bond), expiry: BigInt(f.expiry), earmarkList: P.fromHex(f.earmarkListHex) })
        : await signer.merchant({ merchantKeyHash: P.fromHex(f.merchantKeyHashHex), displayName: f.displayName });
      expect(P.toHex(P.base64urlDecode(actual))).toBe(sample.wireHex);
      expect(() => verify(P.fromHex(sample.wireHex))).not.toThrow();
    }
  });
  test.each(['forged', 'truncated', 'wrong-key', 'wrong-program', 'wrong-cluster'])(`${kind} %s certificate fails closed`, failure => {
    let wire = P.fromHex(samples[0].wireHex); let target = deployment; let key = publicKey;
    if (failure === 'forged') { wire = Uint8Array.from(wire); wire[89] ^= 1; }
    if (failure === 'truncated') wire = wire.slice(0, -1);
    if (failure === 'wrong-key') key = new Uint8Array(32).fill(5);
    if (failure === 'wrong-program') target = { ...deployment, programId: new Uint8Array(32).fill(7) };
    if (failure === 'wrong-cluster') target = { ...deployment, clusterId: 1 };
    expect(() => verify(wire, target, key)).toThrow(P.PaymentError);
  });
}
