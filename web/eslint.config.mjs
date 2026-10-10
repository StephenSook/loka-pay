import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // The defaults of eslint-config-next, restated because this list replaces them.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright output.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
