import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  },
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
