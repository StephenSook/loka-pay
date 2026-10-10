import * as P from '@lokapay/protocol';
import type { CertificateSigner } from '../remit/types.js';

// The caller supplies the existing VPS secret. This module never reads or generates keys.
export function certificateSigner(deployment: P.Deployment, seed: Uint8Array): CertificateSigner {
  if (deployment.clusterId !== 0 || seed.length !== 32) throw new Error('Expected devnet and an Ed25519 seed');
  return {
    allow: fields => P.base64urlEncode(P.signAllowWire(deployment, fields, seed)),
    merchant: fields => P.base64urlEncode(P.signMerchWire(deployment, fields, seed)),
  };
}
