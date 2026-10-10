import * as P from '@lokapay/protocol';

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string) {
    super(messages[code] ?? 'The request could not be completed.');
  }
}

const messages: Record<string, string> = {
  bad_json: 'The JSON body is missing a required field or contains an unsupported field.',
  bad_base64url: 'Bytes must use canonical base64url without padding.',
  bad_pubkey: 'The public key must be a valid compressed P-256 point.',
  name_length: 'The merchant name must contain 1 to 64 UTF-8 bytes after normalization.',
  unknown_note: 'No settlement attempt exists for this note id.',
  payer_mismatch: 'The supplied payer key does not match the allowance account.',
  budget_exhausted: 'The selected wallet pool has reached its daily budget.',
  chain_unavailable: 'Chain data is unavailable. Nothing was signed; you may retry.',
  length: 'The payment note has the wrong byte length.',
  prefix: 'The payment note has an invalid domain prefix.',
  cluster: 'The payment note names the wrong Solana cluster.',
  currency: 'The payment note names an unsupported currency.',
  amount_zero: 'The payment amount must be greater than zero.',
  wrong_program: 'The payment note names the wrong program.',
  wrong_mint: 'The payment note names the wrong token mint.',
  high_s: 'The signature must use the canonical low-S form.',
  bad_signature: 'The signature does not verify over the payment note.',
  bad_ack: 'The merchant acknowledgement does not verify for this note and payee.',
};

export function validateUpload(input: unknown, deployment: P.Deployment) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'bad_json');
  const body = input as Record<string, unknown>;
  if (typeof body.note !== 'string' || Object.keys(body).some(key => !['note', 'ack'].includes(key))
    || ('ack' in body && typeof body.ack !== 'string')) throw new HttpError(400, 'bad_json');
  const decode = (text: string) => {
    try { return P.base64urlDecode(text); } catch { throw new HttpError(400, 'bad_base64url'); }
  };
  const wire = decode(body.note);
  let validated: P.ValidatedNote;
  try { validated = P.validateNoteWire(wire, deployment); }
  catch (error) {
    if (error instanceof P.PaymentError) throw new HttpError(422, error.code);
    throw error;
  }
  const ack = body.ack as string | undefined;
  if (ack !== undefined) {
    const bytes = decode(ack);
    try { P.verifyAckWire(bytes, validated); } catch { throw new HttpError(422, 'bad_ack'); }
  }
  return { validated, note: body.note, ack: ack ?? null, noteId: P.toHex(validated.noteId) };
}
