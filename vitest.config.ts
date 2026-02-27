import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 5000,
    isolate: false,
    maxConcurrency: 1,
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});
