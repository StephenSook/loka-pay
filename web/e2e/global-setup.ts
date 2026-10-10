import { startUpstream } from "./fixtures/upstream";

// Starts the local stand-in for devnet and GitHub (e2e/fixtures/upstream.ts) before the e2e
// tests and stops it after them. The healthy e2e server reads it (playwright.config.ts).
export default async function globalSetup() {
  const server = await startUpstream();
  return async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
}
