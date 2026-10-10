import * as P from '@lokapay/protocol';

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code); }
}

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
