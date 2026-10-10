// Offline software-verifier benchmark only. Its numbers are not chain throughput.
import { createRequire } from 'node:module';
import { createPublicKey, ECDH, verify } from 'node:crypto';
import { availableParallelism, cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const { p256 } = await import(require.resolve('@noble/curves/nist.js'));
const { benchmark } = process.argv.includes('--self-test') ? { benchmark: false } : { benchmark: true };
const secret = new Uint8Array(32); secret[31] = 1; // Public throwaway benchmark key, no custody.
const message = Buffer.from('LOKA software verification benchmark');
const compressed = p256.getPublicKey(secret), uncompressed = ECDH.convertKey(compressed, 'prime256v1', undefined, undefined, 'uncompressed');
const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: uncompressed.subarray(1, 33).toString('base64url'), y: uncompressed.subarray(33).toString('base64url') }, format: 'jwk' });
const signature = p256.sign(message, secret, { lowS: true });
const methods = { noble: () => p256.verify(signature, message, compressed, { lowS: true }),
  nodeCrypto: () => verify('sha256', message, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature) };
for (const method of Object.values(methods)) if (!method()) throw new Error('Verifier self-check failed');
const bad = Buffer.from(message); bad[0] ^= 1;
if (p256.verify(signature, bad, compressed) || verify('sha256', bad, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Wrong message accepted');
if (benchmark) {
  const iterations = 1000, results = {};
  for (const [name, method] of Object.entries(methods)) {
    for (let warmup = 0; warmup < 100; warmup++) method();
    const start = performance.now(); for (let n = 0; n < iterations; n++) if (!method()) throw new Error('Verify failed');
    const seconds = (performance.now() - start) / 1000; results[name] = { iterations, seconds, operationsPerSecond: iterations / seconds };
  }
  const output = { source: 'local_software_benchmark', generatedAt: new Date().toISOString(), nproc: availableParallelism(),
    cpuModel: cpus()[0]?.model ?? 'unavailable', nodeVersion: process.version, results, scope: 'Single process software verify, not on-chain throughput' };
  mkdirSync(fileURLToPath(new URL('../measurements/', import.meta.url)), { recursive: true });
  writeFileSync(new URL('../measurements/p256-verify.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output));
}
