// The published test receipt for /verify, read from protocol/vectors/payment-v1.json at
// build time (imported by the server page, so only these few strings reach the browser).
// Every key in that file is derived from a public label: anyone can sign with them.

import { equalBytes, fromHex } from "@lokapay/protocol";
import vectors from "../../protocol/vectors/payment-v1.json";
import { decodeBase58, encodeBase58 } from "./base58";
import type { SerializedDeployment } from "./receipt";

export const VECTORS_FILE = "protocol/vectors/payment-v1.json";
const RECEIPT_NAME = "note_0_with_confirmation";

export interface TestVector {
  /** The vector's name in the file's `receipts` list. */
  name: string;
  /** The transport form, `L1|P|1|X|<base64url>`. */
  transport: string;
  deployment: SerializedDeployment;
}

function buildFailure(message: string): never {
  throw new Error(`${VECTORS_FILE}: ${message}`);
}

const receipt = vectors.receipts.find((r) => r.name === RECEIPT_NAME);
if (!receipt) buildFailure(`no receipt named ${RECEIPT_NAME}`);

const { constants } = vectors;

// Known answers for lib/base58.ts, checked on every build: the program id and mint in
// both directions, and every confirmation's transaction signature.
const base58Checks: Array<[string, boolean]> = [
  ["program id decodes", equalBytes(decodeBase58(constants.programIdBase58), fromHex(constants.programIdHex))],
  ["mint decodes", equalBytes(decodeBase58(constants.mintBase58), fromHex(constants.mintHex))],
  ["program id encodes", encodeBase58(fromHex(constants.programIdHex)) === constants.programIdBase58],
  ["mint encodes", encodeBase58(fromHex(constants.mintHex)) === constants.mintBase58],
  ...vectors.confs.map(
    (c): [string, boolean] => [
      `${c.name} transaction signature encodes`,
      encodeBase58(fromHex(c.fields.txSignatureHex)) === c.fields.txSignatureBase58,
    ],
  ),
];
for (const [label, ok] of base58Checks) {
  if (!ok) buildFailure(`base58 known answer failed: ${label}`);
}

export const TEST_VECTOR: TestVector = {
  name: receipt.name,
  transport: receipt.transport,
  deployment: {
    clusterId: constants.clusterIds.devnet,
    programIdHex: constants.programIdHex,
    programIdBase58: constants.programIdBase58,
    mintHex: constants.mintHex,
    mintBase58: constants.mintBase58,
    serverPublicKeyHex: vectors.keys.serverEd25519.publicKeyHex,
  },
};
