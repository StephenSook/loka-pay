import { p256 } from '@noble/curves/nist.js';
import * as P from '@lokapay/protocol';
import { HttpError } from '../settle/validation.js';
import type { Kind, RegistrationRequest } from '../remit/types.js';

export function validateRegistration(kind: Kind, input: unknown): RegistrationRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'bad_json');
  const body = input as Record<string, unknown>;
  const fields = kind === 'payer' ? ['publicKey'] : ['publicKey', 'name'];
  if (Object.keys(body).some(field => !fields.includes(field)) || typeof body.publicKey !== 'string'
    || (kind === 'merchant' && typeof body.name !== 'string')) throw new HttpError(400, 'bad_json');
  let publicKey: Uint8Array;
  try { publicKey = P.base64urlDecode(body.publicKey); } catch { throw new HttpError(400, 'bad_base64url'); }
  try {
    if (publicKey.length !== 33 || ![2, 3].includes(publicKey[0])) throw new Error('Not compressed');
    p256.Point.fromBytes(publicKey).assertValidity();
  } catch { throw new HttpError(400, 'bad_pubkey'); }
  const name = kind === 'merchant' ? (body.name as string).normalize('NFC') : undefined;
  if (name !== undefined && (Buffer.from(name, 'utf8').toString('utf8') !== name || Buffer.byteLength(name) < 1 || Buffer.byteLength(name) > 64)) {
    throw new HttpError(400, 'name_length');
  }
  return { publicKey: body.publicKey, keyHash: P.toHex(P.keyHash(publicKey)), ...(name === undefined ? {} : { name }) };
}
