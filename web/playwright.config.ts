import { defineConfig, devices } from "@playwright/test";
import {
  CLOSED_PORT,
  E2E_ELEVENLABS_KEY,
  E2E_FROM_NUMBER,
  E2E_GITHUB_TOKEN,
  E2E_VONAGE_APP_ID,
  FAILING_PORT,
  UPSTREAM,
  callTestKeys,
} from "./e2e/fixtures/ports";
import { unitProject } from "./playwright.unit.config";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);
const closed = `http://127.0.0.1:${CLOSED_PORT}`;
// /call (PLAN.md 3.9): a key and secret made for this run only (e2e/fixtures/ports.ts).
const callKeys = callTestKeys();
/** Every variable /call reads, empty: the failing server has calls off, whatever the shell has set. */
const CALLS_OFF = {
  LOKA_VONAGE_APPLICATION_ID: "",
  LOKA_VONAGE_PRIVATE_KEY_B64: "",
  LOKA_VONAGE_FROM_NUMBER: "",
  ELEVENLABS_API_KEY: "",
  LOKA_CALL_SECRET: "",
  LOKA_CALLS_OFF: "",
  LOKA_ELEVENLABS_VOICE_ID: "",
  LOKA_PUBLIC_ORIGIN: "",
  LOKA_VONAGE_API_URL: "",
  LOKA_ELEVENLABS_API_URL: "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  // A local stand-in for devnet and GitHub (e2e/fixtures/upstream.ts), so the server pages'
  // success path is tested with known values every run.
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    // Decoder and parser unit tests (no browser); see playwright.unit.config.ts.
    unitProject,
    { name: "chromium", testDir: "./e2e", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", testDir: "./e2e", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      // Serves a production build whose server reads go to the stand-in. CI runs `pnpm run
      // build` as its own step just before this, so there it only starts the server; locally
      // it builds first. /live still reads real devnet from the browser.
      command: isCI ? "pnpm run start:e2e" : "pnpm run build && pnpm run start:e2e",
      url: baseURL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        // The explicit test mode that lets the server read a local stand-in (lib/test-upstream.ts).
        LOKA_E2E_UPSTREAM: "1",
        SOLANA_RPC_URL: `${UPSTREAM}/rpc`,
        GITHUB_API_URL: `${UPSTREAM}/github`,
        GITHUB_TOKEN: E2E_GITHUB_TOKEN,
        // /call places its calls through the stand-in's Vonage and ElevenLabs (test mode only).
        ...CALLS_OFF,
        LOKA_VONAGE_APPLICATION_ID: E2E_VONAGE_APP_ID,
        LOKA_VONAGE_PRIVATE_KEY_B64: callKeys.keyB64,
        LOKA_VONAGE_FROM_NUMBER: E2E_FROM_NUMBER,
        ELEVENLABS_API_KEY: E2E_ELEVENLABS_KEY,
        LOKA_CALL_SECRET: callKeys.secret,
        LOKA_PUBLIC_ORIGIN: baseURL,
        LOKA_VONAGE_API_URL: `${UPSTREAM}/vonage`,
        LOKA_ELEVENLABS_API_URL: `${UPSTREAM}/elevenlabs`,
      },
    },
    {
      // The same build, whose server reads all go to a port where nothing listens: the
      // failure-path tests. Its endpoints differ, so it shares no cache entry with the first.
      command: `pnpm exec next start -H 127.0.0.1 -p ${FAILING_PORT}`,
      url: `http://127.0.0.1:${FAILING_PORT}`,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        LOKA_E2E_UPSTREAM: "1",
        SOLANA_RPC_URL: closed,
        GITHUB_API_URL: `${closed}/github`,
        GITHUB_TOKEN: "",
        ...CALLS_OFF,
      },
    },
  ],
});
