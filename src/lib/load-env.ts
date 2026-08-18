/**
 * Load environment files for NON-Next.js entry points (the worker process and the
 * scripts). Next.js loads .env.local itself; plain `tsx` does not.
 *
 * Import this FIRST — before anything that reads process.env at module scope, which
 * includes src/db/client.ts. ESM evaluates imports in order, so a bare
 * `import './load-env'` at the top of an entry point is sufficient.
 *
 * Precedence matches Next.js: .env.local wins over .env.
 */

import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const file of ['.env.local', '.env']) {
  const path = join(root, file);
  if (existsSync(path)) {
    config({ path, override: false });
  }
}
