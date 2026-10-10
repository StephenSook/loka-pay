import type * as P from '@lokapay/protocol';
import type { PreparedAttempt } from '../settle/types.js';

export type Kind = 'payer' | 'merchant';
export type PoolName = 'team' | 'public';
export interface Cost { units: string; funderLamports: string; feeLamports: string }
export interface Policy {
  capUnits: string; offlineLimitUnits: string; bondUnits: string;
  lifetimeSeconds: number; earmarks: string[]; daily: Cost;
}
export interface RegistrationRequest { publicKey: string; keyHash: string; name?: string }
export interface RegistrationPlan extends RegistrationRequest {
  kind: Kind; pool: PoolName; allowanceId?: string; expiry: number; policy: Policy;
}
export interface Quote { message: string; blockhash: string; lastValidBlockHeight: number; cost: Cost }
export interface RegistrationChain {
  blockHeight(): Promise<number>;
  lookup(attempt: PreparedAttempt, plan: RegistrationPlan): Promise<{ found: boolean; outcome: 'ok' | 'collision' | 'failed' | null }>;
  taken(id: string): Promise<boolean>;
  existingMerchant(publicKey: string): Promise<string | null>;
  quote(plan: RegistrationPlan): Promise<Quote>;
  sign(quote: Quote, plan: RegistrationPlan): Promise<PreparedAttempt>;
  send(attempt: PreparedAttempt): Promise<void>;
  observe(attempt: PreparedAttempt, plan: RegistrationPlan): Promise<'ok' | 'collision' | 'failed' | null>;
}
export interface CertificateSigner {
  allow(fields: P.AllowFields): string | Promise<string>;
  merchant(fields: P.MerchFields): string | Promise<string>;
}
export interface Result { statusCode: 200 | 201 | 202 | 409; body: Record<string, unknown> }
export interface Job {
  id: string; plan: RegistrationPlan; attempt: PreparedAttempt | null; result: Result | null;
}
