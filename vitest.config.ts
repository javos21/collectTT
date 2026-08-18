import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Constraint tests share one database; running files in parallel would have them
    // fighting over the same fixture rows.
    fileParallelism: false,
    testTimeout: 20_000,
    setupFiles: ['./tests/setup.ts'],
  },
});
