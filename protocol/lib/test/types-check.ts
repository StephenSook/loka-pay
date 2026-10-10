// Compiled by `pnpm typecheck` (no emit). Fails if index.d.ts drifts from how callers use it.
import {
  PaymentError,
  SIZES,
  decodeTransport,
  displayAmount,
  encodeNote,
  isEquivocation,
  secp256r1InstructionData,
  signConfWire,
  validateNoteWire,
  verifyAllowWire,
  verifyReceipt,
  type Deployment,
} from '@lokapay/protocol';

const d: Deployment = { programId: new Uint8Array(32), clusterId: 0, mint: new Uint8Array(32) };
const bytes: Uint8Array = encodeNote(d, { allowanceId: 1n, payeeKeyHash: new Uint8Array(32), amount: 1n, serial: 0, expiry: 1n });
const wire = new Uint8Array(SIZES.noteWire);

try {
  const v = validateNoteWire(wire, d);
  const r = verifyReceipt(wire, d, new Uint8Array(32));
  const status: 'pending' | 'settled' | 'failed_on_chain' | 'refused_off_chain' = r.status;
  const cert = verifyAllowWire(wire, d, new Uint8Array(32));
  const conflict: boolean = isEquivocation(v, v, cert);
  void status;
  void conflict;
} catch (e) {
  if (e instanceof PaymentError) {
    const code: string = e.code;
    void code;
  }
}

const conf: Uint8Array = signConfWire(
  { noteId: bytes, txSignature: new Uint8Array(64), slot: 1n, blockTime: 1n, uploadedAt: 1n, status: 'settled' },
  new Uint8Array(32),
);
const pre: Uint8Array = secp256r1InstructionData([{ publicKey: new Uint8Array(33), signature: new Uint8Array(64), message: bytes }]);
const t = decodeTransport('L1|P|1|N|AA');
const amount: string = displayAmount(1_000_000n);
void conf;
void pre;
void t;
void amount;
