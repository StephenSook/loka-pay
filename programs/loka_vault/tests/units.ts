import { describe, expect, test } from 'vitest';
import * as P from '@lokapay/protocol';
import { vectors } from './helpers.js';

describe('shared units and canonical bytes', () => {
  test('every committed units vector preserves all mint base units', () => {
    for (const v of vectors.units) {
      expect(P.parseAmount(v.display)).toBe(BigInt(v.baseUnits));
      expect(P.displayAmount(BigInt(v.baseUnits))).toBe(v.display);
    }
    expect(P.parseAmount('18446744073709.551615')).toBe(2n ** 64n - 1n);
    expect(P.parseAmount('18446744073709.551616')).toBeNull();
    expect(P.parseAmount('0.0000001')).toBeNull();
  });
  test('the transaction builder reproduces every golden precompile byte', () => {
    for (const v of vectors.notes) {
      expect(P.toHex(P.secp256r1InstructionData([{
        message: P.fromHex(v.noteHex), signature: P.fromHex(v.signatureHex), publicKey: P.fromHex(v.payerPublicKeyHex),
      }]))).toBe(v.precompileDataHex);
    }
  });
});
