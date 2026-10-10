import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PublicKey } from '@solana/web3.js';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import { validateRegistration } from '../certs/validation.js';

const { values } = parseArgs({ options: { 'run-devnet': { type: 'boolean' }, api: { type: 'string' },
  'payer-request': { type: 'string' }, 'merchant-request': { type: 'string' } } });
assert(values['run-devnet'], 'Explicit --run-devnet is required. Registration spends VPS devnet funds.');
assert(values.api && values['payer-request'] && values['merchant-request'], 'Supply --api, --payer-request and --merchant-request');
const api = new URL(values.api);
assert(api.protocol === 'https:' && !api.username && !api.password, 'Use an HTTPS API URL without credentials');
const pins = JSON.parse(readFileSync(new URL('../../../config/pins.json', import.meta.url), 'utf8'));
assert(pins.cluster === 'devnet' && typeof pins.serverEd25519PublicKey === 'string', 'Publish the certificate-key pin first');
const serverKey = /^[0-9a-fA-F]{64}$/.test(pins.serverEd25519PublicKey) ? P.fromHex(pins.serverEd25519PublicKey) : base58.decode(pins.serverEd25519PublicKey);
const deployment = { programId: new PublicKey(pins.programId).toBytes(), mint: new PublicKey(pins.mint).toBytes(), clusterId: 0 };
for (const kind of ['payer', 'merchant'] as const) {
  const request = JSON.parse(readFileSync(values[`${kind}-request`]!, 'utf8'));
  const key = validateRegistration(kind, request);
  const post = async () => {
    const response = await fetch(new URL(`/v1/${kind}s`, api), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(30000) });
    const body = await response.json() as Record<string, unknown>;
    assert([200, 201, 202].includes(response.status), JSON.stringify({ status: response.status, body }));
    return { status: response.status, body };
  };
  let result = await post();
  for (let poll = 0; poll < 30 && result.status === 202; poll++) {
    await new Promise(resolve => setTimeout(resolve, 2000)); result = await post();
  }
  assert(result.status !== 202, 'Still pending. Investigate the saved signature; do not reset the journal.');
  if (kind === 'payer') {
    const cert = P.verifyAllowWire(P.base64urlDecode(result.body.allowance as string), deployment, serverKey);
    assert.equal(P.toHex(cert.payerKeyHash), key.keyHash); assert.equal(cert.allowanceId.toString(), result.body.allowanceId);
  } else {
    const cert = P.verifyMerchWire(P.base64urlDecode(result.body.merchant as string), deployment, serverKey);
    assert.equal(P.toHex(cert.merchantKeyHash), key.keyHash);
  }
  const repeat = await post(); assert.equal(repeat.status, 200); assert.deepEqual(repeat.body, result.body);
  console.log(JSON.stringify({ check: `${kind}-registered-and-replayed`, ...result.body }, null, 2));
}
