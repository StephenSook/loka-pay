import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { validateRegistrationPins } from './integration.js';

test('published PR16 addresses route each signer; unset or mismatched certificate pins fail closed', () => {
  const pins = JSON.parse(readFileSync(new URL('../../../config/pins.json', import.meta.url), 'utf8'));
  const seed = randomBytes(32);
  // Public-only stand-ins check routing; no deployed private key is accessed.
  const signer = (address: string) => ({ publicKey: new PublicKey(address), secretKey: new Uint8Array(64) });
  const wallets = { team: { funder: signer(pins.wallets.tableDemo), feePayer: signer(pins.feePayers.demo) },
    public: { funder: signer(pins.wallets.publicOnboarding), feePayer: signer(pins.feePayers.public) } };
  expect(() => validateRegistrationPins({ ...pins, serverEd25519PublicKey: null }, wallets, seed)).toThrow('Publish');
  pins.serverEd25519PublicKey = base58.encode(ed25519.getPublicKey(seed));
  expect(validateRegistrationPins(pins, wallets, seed).clusterId).toBe(0);
  expect(() => validateRegistrationPins(pins, { team: wallets.public, public: wallets.team }, seed)).toThrow('signer');
  expect(() => validateRegistrationPins(pins, wallets, randomBytes(32))).toThrow('Certificate signer');
  expect(() => validateRegistrationPins({ ...pins, cluster: 'mainnet' }, wallets, seed)).toThrow('devnet');
  pins.accounts.vault = Keypair.generate().publicKey.toBase58();
  expect(() => validateRegistrationPins(pins, wallets, seed)).toThrow('Vault pins');
});
