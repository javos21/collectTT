/**
 * Environment, validated once at startup rather than discovered as `undefined` at 3am.
 *
 * The local defaults match docker-compose.yml, so a fresh clone runs with
 * `cp .env.example .env.local` and nothing else. Production overrides every value.
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  // Storage: MinIO locally, Cloudflare R2 in production. Same S3 API either way —
  // only these values change, never the code.
  STORAGE_ENDPOINT: z.string().url(),
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  STORAGE_PUBLIC_URL: z.string().url(),

  // "console" keeps verification/reset and notification email testable offline.
  EMAIL_ADAPTER: z.enum(['console', 'brevo']).default('console'),
  BREVO_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('CollectTT <noreply@example.com>'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached !== null) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${detail}\n\n` +
        `Copy .env.example to .env.local and run \`docker compose up -d\`.`,
    );
  }

  if (parsed.data.EMAIL_ADAPTER === 'brevo' && !parsed.data.BREVO_API_KEY) {
    throw new Error('EMAIL_ADAPTER=brevo requires BREVO_API_KEY to be set.');
  }

  cached = parsed.data;
  return cached;
}

export const isProduction = (): boolean => env().NODE_ENV === 'production';
