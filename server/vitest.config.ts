import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/{app,settle,certs,remit}/**/*.test.ts'], fileParallelism: false, testTimeout: 30000 } });
