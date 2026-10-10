import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/settle/**/*.test.ts'], fileParallelism: false, testTimeout: 30000 } });
