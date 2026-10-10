// Every vector in protocol/vectors/payment-v1.json, through @lokapay/protocol.
// This is a second implementation (the vectors come from tools/vectors/gen.mjs), so a pass
// here means the two agree byte for byte.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as P from '../src/index.js';

const V = JSON.parse(readFileSync(new URL('../../vectors/payment-v1.json', import.meta.url), 'utf8'));
const h = P.fromHex;
const D = { programId: h(V.constants.programIdHex), clusterId: 0, mint: h(V.constants.mintHex) };
const SERVER_PUB = h(V.keys.serverEd25519.publicKeyHex);
const SERVER_SECRET = sha256(new TextEncoder().encode(V.keys.serverEd25519.label));
const errorOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof P.PaymentError ? e.code : `not a PaymentError: ${e}`;
  }
  return 'no error';
};

describe('NOTE_V1', () => {
  test('valid notes encode, decode and validate byte-exact', () => {
    expect(V.notes.length).toBeGreaterThanOrEqual(4);
    for (const n of V.notes) {
      const f = n.fields;
      const bytes = P.encodeNote(D, {
        allowanceId: BigInt(f.allowanceId),
        payeeKeyHash: h(f.payeeKeyHashHex),
        amount: BigInt(f.amount),
        serial: f.serial,
        expiry: BigInt(f.expiry),
      });
      expect(P.toHex(bytes)).toBe(n.noteHex);
      expect(P.toHex(P.noteId(bytes))).toBe(n.noteIdHex);
      const v = P.validateNoteWire(h(n.wireHex), D);
      expect(P.toHex(v.noteId)).toBe(n.noteIdHex);
      expect(P.encodeTransport('N', h(n.wireHex))).toBe(n.transport);
      expect(P.toHex(P.normalizeLowS(h(n.highSTwinSignatureHex)))).toBe(n.signatureHex);
      const pre = P.secp256r1InstructionData([{ publicKey: h(n.payerPublicKeyHex), signature: h(n.signatureHex), message: bytes }]);
      expect(P.toHex(pre)).toBe(n.precompileDataHex);
    }
  });

  test('every invalid note fails with the spec error name', () => {
    expect(V.invalidNotes.length).toBeGreaterThanOrEqual(15);
    for (const c of V.invalidNotes) {
      expect(errorOf(() => P.validateNoteWire(h(c.wireHex), D)), c.name).toBe(c.error);
    }
  });
});

describe('structures', () => {
  const note0 = P.validateNoteWire(h(V.notes[0].wireHex), D);

  test('ack', () => {
    const a = V.acks[0];
    expect(P.toHex(P.encodeAck(note0.noteId, BigInt(a.fields.receivedAt)))).toBe(a.ackHex);
    expect(P.verifyAckWire(h(a.wireHex), note0).receivedAt).toBe(BigInt(a.fields.receivedAt));
  });

  test('conf: sign reproduces the vector, verify reads every field', () => {
    for (const c of V.confs) {
      const f = c.fields;
      const fields = {
        noteId: h(f.noteIdHex), txSignature: h(f.txSignatureHex), slot: BigInt(f.slot), blockTime: BigInt(f.blockTime),
        uploadedAt: BigInt(f.uploadedAt), status: f.status, errorCode: f.errorCode,
      };
      expect(P.toHex(P.signConfWire(fields, SERVER_SECRET))).toBe(c.wireHex);
      const v = P.verifyConfWire(h(c.wireHex), SERVER_PUB);
      expect(v.status).toBe(f.statusCode);
      expect(v.uploadedAt).toBe(BigInt(f.uploadedAt));
    }
  });

  test('allowances and merchants sign and verify', () => {
    for (const a of V.allowances) {
      const f = a.fields;
      const fields = {
        allowanceId: BigInt(f.allowanceId), payerKeyHash: h(f.payerKeyHashHex), cap: BigInt(f.cap),
        offlineLimit: BigInt(f.offlineLimit), expiry: BigInt(f.expiry), earmarkList: h(f.earmarkListHex), bond: BigInt(f.bond),
      };
      expect(P.toHex(P.signAllowWire(D, fields, SERVER_SECRET))).toBe(a.wireHex);
      expect(P.verifyAllowWire(h(a.wireHex), D, SERVER_PUB).cap).toBe(BigInt(f.cap));
    }
    const swapped = Uint8Array.from([...h(V.allowances[1].wireHex).slice(0, 185 + 64), 0, 0]);
    expect(errorOf(() => P.verifyAllowWire(swapped, D, SERVER_PUB))).toBe('earmark_mismatch');
    for (const m of V.merchants) {
      expect(P.toHex(P.signMerchWire(D, { merchantKeyHash: h(m.fields.merchantKeyHashHex), displayName: m.fields.displayName }, SERVER_SECRET))).toBe(m.wireHex);
      expect(P.verifyMerchWire(h(m.wireHex), D, SERVER_PUB).displayName).toBe(m.fields.displayName);
    }
  });

  test('earmarks, withdraw, refund', () => {
    for (const e of V.earmarks) {
      expect(P.toHex(P.earmarkHash(h(e.listHex)))).toBe(e.hashHex);
      expect(P.toHex(P.encodeEarmarks(P.decodeEarmarks(h(e.listHex)).reverse()))).toBe(e.listHex);
    }
    const w = V.withdraws[0];
    const wb = P.encodeWithdraw(D, { merchantKeyHash: h(w.fields.merchantKeyHashHex), destination: h(w.fields.destinationHex), amount: BigInt(w.fields.amount), counter: BigInt(w.fields.counter) });
    expect(P.toHex(wb)).toBe(w.withdrawHex);
    P.verifyP256(h(w.signatureHex), wb, h(w.merchantPublicKeyHex));
    const r = V.refunds[0];
    const rb = P.encodeRefund(D, { noteId: h(r.fields.noteIdHex), allowanceId: BigInt(r.fields.allowanceId), amount: BigInt(r.fields.amount), counter: BigInt(r.fields.counter) });
    expect(P.toHex(rb)).toBe(r.refundHex);
    P.verifyP256(h(r.signatureHex), rb, h(r.merchantPublicKeyHex));
  });
});

describe('bindings', () => {
  const note0 = P.validateNoteWire(h(V.notes[0].wireHex), D);
  const ackWire = h(V.acks[0].wireHex);

  test('receipt status comes from the matching signed CONF', () => {
    expect(P.verifyReceipt(h(V.receipts[0].wireHex), D, SERVER_PUB).status).toBe('settled');
    expect(P.verifyReceipt(h(V.receipts[1].wireHex), D, SERVER_PUB).status).toBe('pending');
    const failed = P.receiptBundle(h(V.notes[0].wireHex), ackWire, h(V.confs[1].wireHex));
    expect(P.verifyReceipt(failed, D, SERVER_PUB).status).toBe('failed_on_chain');
    const other = P.signConfWire({ noteId: new Uint8Array(32).fill(9), txSignature: new Uint8Array(64), slot: 1n, blockTime: 2n, uploadedAt: 1n, status: 'settled' }, SERVER_SECRET);
    const forged = P.receiptBundle(h(V.notes[0].wireHex), ackWire, other);
    expect(errorOf(() => P.verifyReceipt(forged, D, SERVER_PUB))).toBe('confirmation_mismatch');
    expect(P.toHex(P.markerBundle(h(V.notes[0].wireHex), ackWire))).toBe(V.markers[0].wireHex);
  });

  test('equivocation needs the certificate payer on both notes', () => {
    const cert = P.verifyAllowWire(h(V.allowances[0].wireHex), D, SERVER_PUB);
    const first = P.validateNoteWire(h(V.equivocation.firstNoteWireHex), D);
    const second = P.validateNoteWire(h(V.equivocation.secondNoteWireHex), D);
    const impostor = P.validateNoteWire(h(V.equivocation.impostorNoteWireHex), D);
    expect(P.isEquivocation(first, second, cert)).toBe(true);
    expect(P.isEquivocation(first, impostor, cert)).toBe(false);
    expect(P.isEquivocation(first, first, cert)).toBe(false);
    expect(note0.note.allowanceId).toBe(cert.allowanceId);
  });

  test('the derived test server key matches the vectors', () => {
    expect(P.toHex(ed25519.getPublicKey(SERVER_SECRET))).toBe(V.keys.serverEd25519.publicKeyHex);
  });
});

describe('transport and units', () => {
  test('every transport string decodes to its wire', () => {
    for (const key of ['notes', 'acks', 'confs', 'allowances', 'merchants', 'markers', 'receipts']) {
      for (const v of V[key]) expect(P.toHex(P.decodeTransport(v.transport).payload)).toBe(v.wireHex);
    }
  });

  test('other content is ignored, malformed payloads throw', () => {
    expect(P.decodeTransport('L1|T|abc|aGk')).toBeNull();
    expect(P.decodeTransport('L1|P|2|N|AAAA')).toBeNull();
    expect(errorOf(() => P.decodeTransport('L1|P|1|N|AAA='))).toBe('base64url');
    expect(errorOf(() => P.base64urlDecode('AB'))).toBe('base64url');
    expect(P.base64urlDecode('AA')).toEqual(Uint8Array.of(0));
  });

  test('units', () => {
    for (const u of V.units) {
      expect(P.parseAmount(u.display)).toBe(BigInt(u.baseUnits));
      expect(P.displayAmount(BigInt(u.baseUnits))).toBe(u.display);
    }
    expect(P.parseAmount('1.0000001')).toBeNull();
    expect(P.displayAmount(1n)).toBe('0.000001');
  });

  test('batch precompile data puts each note after the previous one', () => {
    const n = V.notes.slice(0, 3).map((x) => ({ publicKey: h(x.payerPublicKeyHex), signature: h(x.signatureHex), message: h(x.noteHex) }));
    const data = P.secp256r1InstructionData(n);
    expect(data[0]).toBe(3);
    expect(data.length).toBe(2 + 14 * 3 + 3 * (33 + 64 + 141));
    const dv = new DataView(data.buffer);
    expect(dv.getUint16(2 + 14 * 2 + 4, true)).toBe(2 + 14 * 3 + 2 * 238); // third pubkey offset
    expect(() => P.secp256r1InstructionData([{ ...n[0], signature: h(V.notes[0].highSTwinSignatureHex) }])).toThrow();
  });
});
