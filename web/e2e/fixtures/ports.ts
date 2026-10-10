// The e2e servers and the local stand-in they read (TEST FIXTURE ports on 127.0.0.1). Kept
// apart from upstream.ts so playwright.config.ts loads nothing from the app.

/** The stand-in for devnet's JSON-RPC (/rpc) and GitHub's API (/github), e2e/fixtures/upstream.ts. */
export const UPSTREAM_PORT = 3190;
export const UPSTREAM = `http://127.0.0.1:${UPSTREAM_PORT}`;
/** Nothing listens here: the failing e2e server's reads all fail. */
export const CLOSED_PORT = 3191;
/** The e2e server whose reads all fail, for the failure-path tests. */
export const FAILING_PORT = 3101;
export const FAILING_URL = `http://127.0.0.1:${FAILING_PORT}`;
/** Sent by the healthy e2e server as GITHUB_TOKEN; the stand-in records the Authorization it receives. */
export const E2E_GITHUB_TOKEN = "e2e-stand-in-token-not-a-secret";
