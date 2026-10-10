// The e2e tests point the server reads at a local stand-in for devnet and GitHub
// (e2e/fixtures/upstream.ts). This module keeps that seam test-only, server only:
// - a loopback endpoint (127.0.0.1, localhost, [::1]) is accepted only while the explicit
//   test mode LOKA_E2E_UPSTREAM=1 is set, and never in a deployed production build
//   (NODE_ENV=production with VERCEL set), so stand-in answers can never count as devnet or
//   GitHub evidence on the real site;
// - in test mode the only GitHub token ever sent is the known test token (lib/github.ts).
// A refused setting throws UpstreamConfigError, which names the variable, never its value, so
// the page shows the read as failed with that reason.

/** The GitHub token the e2e stand-in expects (e2e/fixtures/ports.ts); not a secret. */
export const E2E_TEST_TOKEN = "e2e-stand-in-token-not-a-secret";

export class UpstreamConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamConfigError";
  }
}

/** A production build running on Vercel: the real site, where no test seam may be open. */
export function isDeployedProduction(): boolean {
  return process.env.NODE_ENV === "production" && Boolean(process.env.VERCEL);
}

/** The explicit e2e test mode (playwright.config.ts sets it on its servers only). */
export function testMode(): boolean {
  return process.env.LOKA_E2E_UPSTREAM === "1";
}

/** True for an http(s) URL on this machine's loopback interface. */
export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Throws unless a loopback endpoint named by `name` is allowed here: test mode on, not deployed production. */
export function assertTestUpstream(name: string): void {
  if (isDeployedProduction()) {
    throw new UpstreamConfigError(`${name} names a local test endpoint, which a deployed production build refuses`);
  }
  if (!testMode()) {
    throw new UpstreamConfigError(`${name} names a local test endpoint, which is accepted only in the e2e test mode (LOKA_E2E_UPSTREAM=1)`);
  }
}
