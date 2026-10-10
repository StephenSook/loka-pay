import { expect, test, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { phase3From } from './phase3.js';

const sendEnv = { REMIT_SEND_KEYPAIR_PATH: 'test-only-key', REMIT_CAP_UNITS: '1000000', REMIT_LIFETIME_SECONDS: '3600',
  REMIT_EARMARKS: 'ab'.repeat(32), REMIT_DAILY_UNITS: '10000000', REMIT_DAILY_FUNDER_LAMPORTS: '100000', REMIT_DAILY_FEE_LAMPORTS: '100000' };
test('optional route config is absent by default, and partial send config never reads a key', () => {
  const load = vi.fn(() => Keypair.generate());
  expect(phase3From({}, load).remittance).toBeUndefined();
  expect(phase3From({ REMIT_SEND_KEYPAIR_PATH: 'test-only-key' }, load).remittance).toBeUndefined();
  expect(load).not.toHaveBeenCalled();
});
test('reads only configured send terms, budgets and evidence sources', () => {
  const pair = Keypair.generate(); const load = vi.fn(() => pair);
  const config = phase3From({ ...sendEnv, TRUST_ENABLED: 'true', RESERVES_ENABLED: 'true', VOLUME_MEASUREMENT_PATH: 'measurement',
    VOLUME_BENCHMARK_PATH: 'benchmark', VOLUME_BLOCK_COMPUTE_UNITS: '10000', VOLUME_BLOCK_LIMIT_SOURCE: 'test-only' }, load);
  expect(config.remittance?.wallet).toBe(pair); expect(config.remittance?.policy).toMatchObject({ capUnits: '1000000',
    offlineLimitUnits: '1000000', bondUnits: '0', lifetimeSeconds: 3600, earmarks: ['ab'.repeat(32)] });
  expect(config.volume?.capacity).toEqual({ blockComputeUnits: 10000, source: 'test-only' });
  expect(config.trust).toBe(true); expect(config.reserves).toBe(true);
});
test('invalid optional config and unavailable key files disable routes without throwing or leaking paths', () => {
  const load = vi.fn(() => { throw new Error('sensitive-key-path'); });
  const config = phase3From({ ...sendEnv, TRUST_ENABLED: 'yes', VOLUME_MEASUREMENT_PATH: 'evidence', VOLUME_BLOCK_COMPUTE_UNITS: '1' }, load);
  expect(config.remittance).toBeUndefined(); expect(config.volume).toBeUndefined();
  expect(config.issues).toEqual({ '/trust': 'invalid_config', '/api/volume': 'invalid_config', '/v1/remittances': 'invalid_config' });
  expect(JSON.stringify(config)).not.toContain('sensitive-key-path');
  expect(phase3From({ ...sendEnv, REMIT_CAP_UNITS: '1000001' }, load).issues?.['/v1/remittances']).toBe('invalid_config');
});
