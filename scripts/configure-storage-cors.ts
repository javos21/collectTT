/** Configure browser CORS for the MinIO or R2 bucket used by image uploads. */

import '../src/lib/load-env';

import { configureStorageCors, bucket } from '../src/lib/storage';
import { env } from '../src/lib/env';

function origins(): string[] {
  const configured = process.env.STORAGE_CORS_ORIGINS;
  if (configured !== undefined && configured.trim() !== '') {
    return configured.split(',').map((origin) => origin.trim()).filter(Boolean);
  }

  const app = env();
  const defaults = [app.APP_URL];
  if (app.NODE_ENV !== 'production') {
    defaults.push('http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002');
  }
  return defaults;
}

async function main(): Promise<void> {
  const allowedOrigins = origins();
  await configureStorageCors(allowedOrigins);
  console.log(`[storage] configured CORS for ${bucket()}: ${allowedOrigins.join(', ')}`);
}

main().catch((error: unknown) => {
  console.error('[storage] failed to configure CORS', error);
  process.exit(1);
});
