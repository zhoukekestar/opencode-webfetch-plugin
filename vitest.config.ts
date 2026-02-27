import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 10000,
    isolate: false,
    maxConcurrency: 1,
    sequence: {
      concurrent: false,
    },
  },
});
