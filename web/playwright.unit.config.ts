import { defineConfig } from "@playwright/test";

// Unit tests for the decoders and parsers in lib/ (unit/*.test.ts). They need no browser
// and no server: Playwright is only the test runner, so the web project needs no second
// one. `pnpm test:unit` runs this config; the main config (playwright.config.ts) runs the
// same files as its "unit" project, so `pnpm exec playwright test` in CI runs them too.

export const unitProject = { name: "unit", testDir: "./unit" };

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  projects: [unitProject],
});
