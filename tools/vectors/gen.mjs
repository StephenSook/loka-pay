// Deterministic test vectors for protocol/PAYMENT-V1.md.
//
// Usage (from tools/vectors):
//   pnpm run gen     writes ../../protocol/vectors/payment-v1.json
//   pnpm run check   regenerates in memory and fails if the committed file differs
//
// Every key below is derived from a public label, so the vectors are reproducible
// and no private key file is ever committed. These keys are for tests only.
// ECDSA P-256 signatures are deterministic (RFC 6979, noble-curves default), so the
// same inputs always give the same bytes.

import { readFileSync, writeFileSync } from 'node:fs';
import { p256 } from '@noble/curves/nist.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58, base64urlnopad } from '@scure/base';

const enc = new TextEncoder();

// ---------- byte helpers ----------

const hex = (b) => Buffer.from(b).toString('hex');
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const ascii = (s, len) => {
  const b = enc.encode(s);
  if (b.length !== len) throw new Error(`"${s}" is ${b.length} bytes, want ${len}`);
  return b;
};
const u8 = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new Error(`u8 out of range: ${n}`);
  return Uint8Array.of(n);
};
const u16be = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`u16 out of range: ${n}`);
  return Uint8Array.of(n >> 8, n & 0xff);
};
const u16le = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`u16 out of range: ${n}`);
  return Uint8Array.of(n & 0xff, n >> 8);
};
const u64be = (v) => {
  const n = BigInt(v);
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`u64 out of range: ${v}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, n, false);
  return out;
};
const i64be = (v) => {
  const n = BigInt(v);
  if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) throw new Error(`i64 out of range: ${v}`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, n, false);
  return out;
};
const label = (s) => sha256(enc.encode(s));

// ---------- constants (PAYMENT-V1.md section 2) ----------

const P256_N = p256.Point.Fn.ORDER;
const P256_HALF_N = P256_N >> 1n;
const SECP256R1_PROGRAM_ID = 'Secp256r1SigVerify1111111111111111111111111';

// The program id is a vector-only value (the real one is in config/pins.json after
// task 1.4 deploys). The mint is the real devnet USDC mint.
const PROGRAM_ID = label('LOKA-PAY-V1 vector program id');
const MINT_BASE58 = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MINT = base58.decode(MINT_BASE58);
if (MINT.length !== 32) throw new Error('mint must decode to 32 bytes');
const CLUSTER_DEVNET = 0;

const PREFIX = {
  note: 'LOKA-PAY-NOTE-V1',
  ack: 'LOKA-PAY-ACKN-V1',
  conf: 'LOKA-PAY-CONF-V1',
  allow: 'LOKA-PAY-ALLW-V1',
  merch: 'LOKA-PAY-MRCH-V1',
  withdraw: 'LOKA-PAY-WDRW-V1',
  refund: 'LOKA-PAY-RFND-V1',
};

// ---------- test keys ----------

const p256Key = (name) => {
  // Reduce a label hash into [1, n-1]; deterministic and public on purpose.
  const sk = (BigInt('0x' + hex(label(`LOKA-PAY-V1 test key ${name}`))) % (P256_N - 1n)) + 1n;
  const secretKey = Uint8Array.from(Buffer.from(sk.toString(16).padStart(64, '0'), 'hex'));
  const publicKey = p256.getPublicKey(secretKey, true);
  return { name, secretKey, publicKey, keyHash: sha256(publicKey) };
};
const payer = p256Key('payer');
const merchantA = p256Key('merchant-a');
const merchantB = p256Key('merchant-b');
const serverSecret = label('LOKA-PAY-V1 test key server-ed25519');
const serverPublic = ed25519.getPublicKey(serverSecret);

// ---------- signing ----------

const signP256 = (key, message) => {
  // sign() hashes the message with SHA-256 (prehash default) and returns a
  // 64-byte compact low-S signature (lowS default).
  const sig = p256.sign(message, key.secretKey);
  if (sig.length !== 64) throw new Error('compact signature must be 64 bytes');
  const s = BigInt('0x' + hex(sig.slice(32)));
  if (s > P256_HALF_N) throw new Error('expected a low-S signature');
  if (!p256.verify(sig, message, key.publicKey)) throw new Error('self-check failed');
  return sig;
};
const highSTwin = (sig) => {
  const s = BigInt('0x' + hex(sig.slice(32)));
  const twin = (P256_N - s).toString(16).padStart(64, '0');
  return concat(sig.slice(0, 32), Uint8Array.from(Buffer.from(twin, 'hex')));
};
const signEd = (message) => {
  const sig = ed25519.sign(message, serverSecret);
  if (!ed25519.verify(sig, message, serverPublic)) throw new Error('ed25519 self-check failed');
  return sig;
};

// ---------- structures (PAYMENT-V1.md section 4) ----------

const note = (f) =>
  concat(
    ascii(PREFIX.note, 16),
    f.programId ?? PROGRAM_ID,
    u8(f.clusterId ?? CLUSTER_DEVNET),
    f.mint ?? MINT,
    u64be(f.allowanceId),
    f.payeeKeyHash,
    u64be(f.amount),
    ascii(f.currency ?? 'USD', 3),
    u8(f.serial),
    i64be(f.expiry),
  );

const ack = (noteId, receivedAt) => concat(ascii(PREFIX.ack, 16), noteId, i64be(receivedAt));

const CONF_STATUS = { settled: 1, failed_on_chain: 2, refused_off_chain: 3 };
const conf = (f) =>
  concat(
    ascii(PREFIX.conf, 16),
    f.noteId,
    f.txSignature,
    u64be(f.slot),
    i64be(f.blockTime),
    u8(CONF_STATUS[f.status]),
    u16be(f.errorCode),
  );

const earmarkList = (hashes) => {
  const sorted = [...hashes].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (let i = 1; i < sorted.length; i++) {
    if (Buffer.compare(Buffer.from(sorted[i - 1]), Buffer.from(sorted[i])) === 0) throw new Error('duplicate earmark');
  }
  if (sorted.length > 16) throw new Error('at most 16 earmarks');
  return concat(u16be(sorted.length), ...sorted);
};

const allow = (f) =>
  concat(
    ascii(PREFIX.allow, 16),
    PROGRAM_ID,
    u8(CLUSTER_DEVNET),
    MINT,
    u64be(f.allowanceId),
    f.payerKeyHash,
    u64be(f.cap),
    u64be(f.offlineLimit),
    i64be(f.expiry),
    sha256(f.earmarkListBytes),
    u64be(f.bond),
  );

const merch = (f) => {
  const name = enc.encode(f.displayName.normalize('NFC'));
  if (name.length < 1 || name.length > 64) throw new Error('display name must be 1 to 64 UTF-8 bytes');
  return concat(ascii(PREFIX.merch, 16), PROGRAM_ID, u8(CLUSTER_DEVNET), MINT, f.merchantKeyHash, u16be(name.length), name);
};

const withdraw = (f) =>
  concat(
    ascii(PREFIX.withdraw, 16),
    PROGRAM_ID,
    u8(CLUSTER_DEVNET),
    MINT,
    f.merchantKeyHash,
    f.destination,
    u64be(f.amount),
    u64be(f.counter),
  );

const refund = (f) =>
  concat(
    ascii(PREFIX.refund, 16),
    PROGRAM_ID,
    u8(CLUSTER_DEVNET),
    MINT,
    f.noteId,
    u64be(f.allowanceId),
    u64be(f.amount),
    u64be(f.counter),
  );

// secp256r1 precompile instruction data for one signature, laid out exactly like
// the SDK helper: [count u8][pad u8][offsets 14][pubkey 33][signature 64][message].
const precompileData = (publicKey, signature, message) => {
  const DATA_START = 16;
  const pkOff = DATA_START;
  const sigOff = pkOff + 33;
  const msgOff = sigOff + 64;
  return concat(
    u8(1),
    u8(0),
    u16le(sigOff),
    u16le(0xffff),
    u16le(pkOff),
    u16le(0xffff),
    u16le(msgOff),
    u16le(message.length),
    u16le(0xffff),
    publicKey,
    signature,
    message,
  );
};

const transport = (kind, payload) => `L1|P|1|${kind}|${base64urlnopad.encode(payload)}`;

// ---------- vectors ----------

const EXPIRY = 1893456000n; // 2030-01-01T00:00:00Z, fixed so vectors never change
const RECEIVED_AT = 1791590400n; // 2026-10-10T00:00:00Z

const noteCases = [
  { name: 'one_dollar_serial_0', allowanceId: 1001n, payee: merchantA, amount: 1000000n, serial: 0 },
  { name: 'quarter_serial_1', allowanceId: 1001n, payee: merchantA, amount: 250000n, serial: 1 },
  { name: 'two_dollars_serial_255', allowanceId: 1001n, payee: merchantB, amount: 2000000n, serial: 255 },
  { name: 'max_u64_fields', allowanceId: 0xffffffffffffffffn, payee: merchantB, amount: 0xffffffffffffffffn, serial: 7 },
];

const notes = noteCases.map((c) => {
  const fields = {
    allowanceId: c.allowanceId,
    payeeKeyHash: c.payee.keyHash,
    amount: c.amount,
    serial: c.serial,
    expiry: EXPIRY,
  };
  const bytes = note(fields);
  if (bytes.length !== 141) throw new Error('NOTE_V1 must be 141 bytes');
  const signature = signP256(payer, bytes);
  const wire = concat(bytes, signature, payer.publicKey);
  if (wire.length !== 238) throw new Error('note wire must be 238 bytes');
  const twin = highSTwin(signature);
  return {
    name: c.name,
    fields: {
      programIdHex: hex(PROGRAM_ID),
      clusterId: CLUSTER_DEVNET,
      mintBase58: MINT_BASE58,
      allowanceId: c.allowanceId.toString(),
      payeeKeyHashHex: hex(c.payee.keyHash),
      payee: c.payee.name,
      amount: c.amount.toString(),
      currency: 'USD',
      serial: c.serial,
      expiry: EXPIRY.toString(),
    },
    noteHex: hex(bytes),
    noteIdHex: hex(sha256(bytes)),
    signatureHex: hex(signature),
    payerPublicKeyHex: hex(payer.publicKey),
    wireHex: hex(wire),
    transport: transport('N', wire),
    precompileDataHex: hex(precompileData(payer.publicKey, signature, bytes)),
    highSTwinSignatureHex: hex(twin),
    highSTwinIsValidWithoutLowSRule: p256.verify(twin, bytes, payer.publicKey, { lowS: false }),
  };
});

const n0 = notes[0];
const n0Bytes = Uint8Array.from(Buffer.from(n0.noteHex, 'hex'));
const n0Wire = Uint8Array.from(Buffer.from(n0.wireHex, 'hex'));
const n0Id = sha256(n0Bytes);
const flip = (b, i) => {
  const c = Uint8Array.from(b);
  c[i] ^= 0x01;
  return c;
};
const withByte = (b, i, v) => {
  const c = Uint8Array.from(b);
  c[i] = v;
  return c;
};

// Each invalid case names the first rule it breaks (PAYMENT-V1.md section 6).
const invalidNotes = [
  { name: 'short_by_one', wireHex: hex(n0Wire.slice(0, 237)), error: 'length' },
  { name: 'trailing_byte', wireHex: hex(concat(n0Wire, u8(0))), error: 'length' },
  { name: 'bad_prefix', wireHex: hex(withByte(n0Wire, 15, 0x32)), error: 'prefix' },
  { name: 'cluster_2', wireHex: hex(withByte(n0Wire, 48, 2)), error: 'cluster' },
  { name: 'currency_eur', wireHex: hex(concat(n0Wire.slice(0, 129), ascii('EUR', 3), n0Wire.slice(132))), error: 'currency' },
  {
    name: 'amount_zero',
    wireHex: hex(concat(n0Wire.slice(0, 121), u64be(0n), n0Wire.slice(129))),
    error: 'amount_zero',
  },
  { name: 'high_s_twin', wireHex: hex(concat(n0Bytes, Uint8Array.from(Buffer.from(n0.highSTwinSignatureHex, 'hex')), payer.publicKey)), error: 'high_s' },
  { name: 'amount_changed_after_signing', wireHex: hex(flip(n0Wire, 128)), error: 'bad_signature' },
  { name: 'payee_changed_after_signing', wireHex: hex(flip(n0Wire, 89)), error: 'bad_signature' },
  { name: 'signed_by_another_key', wireHex: hex(concat(n0Bytes, signP256(merchantB, n0Bytes), payer.publicKey)), error: 'bad_signature' },
  { name: 'pubkey_prefix_04', wireHex: hex(withByte(n0Wire, 205, 0x04)), error: 'bad_pubkey' },
  { name: 'r_zero', wireHex: hex(concat(n0Bytes, new Uint8Array(32), n0Wire.slice(173))), error: 'bad_signature' },
  {
    name: 'wrong_program_id',
    wireHex: (() => {
      const b = note({ programId: label('some other program'), allowanceId: 1001n, payeeKeyHash: merchantA.keyHash, amount: 1000000n, serial: 0, expiry: EXPIRY });
      return hex(concat(b, signP256(payer, b), payer.publicKey));
    })(),
    error: 'wrong_program',
  },
  {
    name: 'wrong_mint',
    wireHex: (() => {
      const b = note({ mint: label('some other mint'), allowanceId: 1001n, payeeKeyHash: merchantA.keyHash, amount: 1000000n, serial: 0, expiry: EXPIRY });
      return hex(concat(b, signP256(payer, b), payer.publicKey));
    })(),
    error: 'wrong_mint',
  },
];

const ackBytes = ack(n0Id, RECEIVED_AT);
const ackSig = signP256(merchantA, ackBytes);
const ackWire = concat(ackBytes, ackSig, merchantA.publicKey);

const TX_SIG = label('vector tx signature part 1').slice(0, 32);
const txSignature = concat(TX_SIG, label('vector tx signature part 2'));
const confCases = [
  { name: 'settled', status: 'settled', slot: 412345678n, blockTime: 1791590403n, errorCode: 0, txSignature },
  { name: 'failed_on_chain_serial_used', status: 'failed_on_chain', slot: 412345999n, blockTime: 1791590500n, errorCode: 6001, txSignature: concat(label('cheat tx 1'), label('cheat tx 2')) },
  { name: 'refused_off_chain', status: 'refused_off_chain', slot: 0n, blockTime: 0n, errorCode: 0, txSignature: new Uint8Array(64) },
];
const confs = confCases.map((c) => {
  const bytes = conf({ ...c, noteId: n0Id });
  const sig = signEd(bytes);
  return {
    name: c.name,
    fields: { noteIdHex: hex(n0Id), txSignatureHex: hex(c.txSignature), txSignatureBase58: base58.encode(c.txSignature), slot: c.slot.toString(), blockTime: c.blockTime.toString(), status: c.status, statusCode: CONF_STATUS[c.status], errorCode: c.errorCode },
    confHex: hex(bytes),
    signatureHex: hex(sig),
    wireHex: hex(concat(bytes, sig)),
    transport: transport('S', concat(bytes, sig)),
  };
});
const confSettledWire = Uint8Array.from(Buffer.from(confs[0].wireHex, 'hex'));

const earmarkCases = [
  { name: 'unrestricted', hashes: [] },
  { name: 'merchant_a_only', hashes: [merchantA.keyHash] },
  { name: 'both_merchants', hashes: [merchantB.keyHash, merchantA.keyHash] },
];
const earmarks = earmarkCases.map((c) => {
  const bytes = earmarkList(c.hashes);
  return { name: c.name, listHex: hex(bytes), hashHex: hex(sha256(bytes)) };
});

const allowCases = [
  { name: 'five_dollars_unrestricted', allowanceId: 1001n, cap: 5000000n, offlineLimit: 3000000n, expiry: EXPIRY, earmark: 0, bond: 500000n },
  { name: 'remittance_earmarked_merchant_a', allowanceId: 2002n, cap: 1000000n, offlineLimit: 1000000n, expiry: EXPIRY, earmark: 1, bond: 100000n },
];
const allowances = allowCases.map((c) => {
  const listBytes = Uint8Array.from(Buffer.from(earmarks[c.earmark].listHex, 'hex'));
  const bytes = allow({ ...c, payerKeyHash: payer.keyHash, earmarkListBytes: listBytes });
  if (bytes.length !== 185) throw new Error('ALLOW_V1 must be 185 bytes');
  const sig = signEd(bytes);
  const wire = concat(bytes, sig, listBytes);
  return {
    name: c.name,
    fields: { allowanceId: c.allowanceId.toString(), payerKeyHashHex: hex(payer.keyHash), cap: c.cap.toString(), offlineLimit: c.offlineLimit.toString(), expiry: c.expiry.toString(), earmarkListHex: hex(listBytes), bond: c.bond.toString() },
    allowHex: hex(bytes),
    signatureHex: hex(sig),
    wireHex: hex(wire),
    transport: transport('A', wire),
  };
});

const merchCases = [
  { name: 'ascii_name', key: merchantA, displayName: 'Campus Coffee Cart' },
  { name: 'utf8_name', key: merchantB, displayName: 'Boutique Ndèye' },
];
const merchants = merchCases.map((c) => {
  const bytes = merch({ merchantKeyHash: c.key.keyHash, displayName: c.displayName });
  const sig = signEd(bytes);
  return {
    name: c.name,
    fields: { merchantKeyHashHex: hex(c.key.keyHash), displayName: c.displayName },
    merchHex: hex(bytes),
    signatureHex: hex(sig),
    wireHex: hex(concat(bytes, sig)),
    transport: transport('C', concat(bytes, sig)),
  };
});

const destination = label('vector destination wallet');
const withdrawBytes = withdraw({ merchantKeyHash: merchantA.keyHash, destination, amount: 1250000n, counter: 0n });
if (withdrawBytes.length !== 161) throw new Error('WITHDRAW_V1 must be 161 bytes');
const withdrawSig = signP256(merchantA, withdrawBytes);

const refundBytes = refund({ noteId: n0Id, allowanceId: 1001n, amount: 500000n, counter: 0n });
if (refundBytes.length !== 137) throw new Error('REFUND_V1 must be 137 bytes');
const refundSig = signP256(merchantA, refundBytes);

const markerWire = concat(n0Wire, ackWire);
const receiptWire = concat(n0Wire, ackWire, u8(1), confSettledWire);
const receiptNoConf = concat(n0Wire, ackWire, u8(0));

const units = [
  { display: '0.01', baseUnits: '10000' },
  { display: '0.25', baseUnits: '250000' },
  { display: '1.00', baseUnits: '1000000' },
  { display: '2.00', baseUnits: '2000000' },
  { display: '5.00', baseUnits: '5000000' },
];

const vectors = {
  spec: 'protocol/PAYMENT-V1.md',
  generator: 'tools/vectors/gen.mjs (pnpm run gen); CI runs pnpm run check',
  warning: 'Every key here is derived from a public label and is for tests only.',
  constants: {
    programIdHex: hex(PROGRAM_ID),
    programIdBase58: base58.encode(PROGRAM_ID),
    programIdNote: 'Vector-only program id. The deployed id is in config/pins.json.',
    clusterIds: { devnet: 0, mainnet: 1 },
    mintBase58: MINT_BASE58,
    mintHex: hex(MINT),
    mintDecimals: 6,
    secp256r1ProgramId: SECP256R1_PROGRAM_ID,
    p256OrderHex: P256_N.toString(16).padStart(64, '0'),
    p256HalfOrderHex: P256_HALF_N.toString(16).padStart(64, '0'),
    prefixes: PREFIX,
    sizes: { NOTE_V1: 141, noteWire: 238, ACK_V1: 56, ackWire: 153, CONF_V1: 131, confWire: 195, ALLOW_V1: 185, WITHDRAW_V1: 161, REFUND_V1: 137, precompileDataOneNote: 254 },
    confStatus: CONF_STATUS,
  },
  keys: {
    payer: { label: 'LOKA-PAY-V1 test key payer', publicKeyHex: hex(payer.publicKey), keyHashHex: hex(payer.keyHash) },
    merchantA: { label: 'LOKA-PAY-V1 test key merchant-a', publicKeyHex: hex(merchantA.publicKey), keyHashHex: hex(merchantA.keyHash) },
    merchantB: { label: 'LOKA-PAY-V1 test key merchant-b', publicKeyHex: hex(merchantB.publicKey), keyHashHex: hex(merchantB.keyHash) },
    serverEd25519: { label: 'LOKA-PAY-V1 test key server-ed25519', publicKeyHex: hex(serverPublic) },
    derivation: 'P-256: secret = (sha256(label) mod (n - 1)) + 1, as a 32-byte big-endian scalar. Ed25519: secret seed = sha256(label).',
  },
  units,
  notes,
  invalidNotes,
  acks: [{ name: 'merchant_a_receives_note_0', fields: { noteIdHex: hex(n0Id), receivedAt: RECEIVED_AT.toString() }, ackHex: hex(ackBytes), signatureHex: hex(ackSig), merchantPublicKeyHex: hex(merchantA.publicKey), wireHex: hex(ackWire), transport: transport('Y', ackWire) }],
  confs,
  earmarks,
  allowances,
  merchants,
  withdraws: [{ name: 'merchant_a_first_withdraw', fields: { merchantKeyHashHex: hex(merchantA.keyHash), destinationHex: hex(destination), destinationBase58: base58.encode(destination), amount: '1250000', counter: '0' }, withdrawHex: hex(withdrawBytes), signatureHex: hex(withdrawSig), merchantPublicKeyHex: hex(merchantA.publicKey) }],
  refunds: [{ name: 'merchant_a_half_refund_of_note_0', fields: { noteIdHex: hex(n0Id), allowanceId: '1001', amount: '500000', counter: '0' }, refundHex: hex(refundBytes), signatureHex: hex(refundSig), merchantPublicKeyHex: hex(merchantA.publicKey) }],
  markers: [{ name: 'note_0_seen_at_merchant_a', wireHex: hex(markerWire), transport: transport('M', markerWire) }],
  receipts: [
    { name: 'note_0_settled', wireHex: hex(receiptWire), transport: transport('X', receiptWire), verifyUrlFragment: `r=${base64urlnopad.encode(receiptWire)}` },
    { name: 'note_0_pending', wireHex: hex(receiptNoConf), transport: transport('X', receiptNoConf) },
  ],
};

// Sizes stated in the spec must match what was built.
const sz = vectors.constants.sizes;
if (ackBytes.length !== sz.ACK_V1 || ackWire.length !== sz.ackWire) throw new Error('ACK size mismatch');
if (Buffer.from(confs[0].confHex, 'hex').length !== sz.CONF_V1 || confSettledWire.length !== sz.confWire) throw new Error('CONF size mismatch');
if (Buffer.from(notes[0].precompileDataHex, 'hex').length !== sz.precompileDataOneNote) throw new Error('precompile size mismatch');

const out = JSON.stringify(vectors, null, 2) + '\n';
const args = process.argv.slice(2);
const check = args.includes('--check');
const target = args.filter((a) => a !== '--check')[0];
if (!target) throw new Error('usage: gen.mjs [--check] <output.json>');
if (check) {
  let committed;
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    console.error(`FAIL: ${target} is missing; run pnpm run gen and commit it`);
    process.exit(1);
  }
  if (committed !== out) {
    console.error(`FAIL: ${target} is stale; run pnpm run gen and commit the result`);
    process.exit(1);
  }
  console.log(`OK: ${target} matches the generator (${notes.length} notes, ${invalidNotes.length} invalid cases)`);
} else {
  writeFileSync(target, out);
  console.log(`wrote ${target} (${out.length} bytes)`);
}
