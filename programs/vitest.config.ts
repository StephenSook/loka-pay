import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['loka_vault/tests/{redeem,withdraw,units}.ts'],
    fileParallelism: false,
    isolate: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
