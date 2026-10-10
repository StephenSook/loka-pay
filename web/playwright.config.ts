import { defineConfig, devices } from "@playwright/test";
import { unitProject } from "./playwright.unit.config";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
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
  webServer: {
    // Serves a production build. CI runs `pnpm run build` as its own step just
    // before this, so there it only starts the server; locally it builds first.
    command: isCI ? "pnpm run start:e2e" : "pnpm run build && pnpm run start:e2e",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
  },
});
