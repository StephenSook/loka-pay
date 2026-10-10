import { expect, test } from 'vitest';
import { HttpError } from './validation.js';

test('HTTP errors keep their stable code and provide a plain-English message', () => {
  const error = new HttpError(422, 'payer_mismatch');
  expect(error.statusCode).toBe(422); expect(error.code).toBe('payer_mismatch');
  expect(error.message).toBe('The supplied payer key does not match the allowance account.');
  expect(new HttpError(400, 'future_code').message).toBe('The request could not be completed.');
});
