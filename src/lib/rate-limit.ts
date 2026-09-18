import { sql } from 'drizzle-orm';

import { db, type DbOrTx } from '@/db/client';

const MAX_KEY_LENGTH = 240;

export const RATE_LIMITS = {
  availability: { limit: 30, windowSeconds: 60 },
  upload: { limit: 30, windowSeconds: 60 },
  listingCreate: { limit: 20, windowSeconds: 60 },
  claim: { limit: 10, windowSeconds: 60 },
  offer: { limit: 20, windowSeconds: 60 },
  bid: { limit: 60, windowSeconds: 60 },
  transaction: { limit: 20, windowSeconds: 60 },
  adminMutation: { limit: 60, windowSeconds: 60 },
} as const;

/** Authentication budgets are intentionally longer-lived than commerce actions. */
export const AUTH_RATE_LIMITS = {
  signIn: { limit: 10, windowSeconds: 300, ipLimit: 30 },
  signUp: { limit: 5, windowSeconds: 900, ipLimit: 15 },
  verificationSend: { limit: 3, windowSeconds: 600, ipLimit: 15 },
  verificationCheck: { limit: 10, windowSeconds: 600, ipLimit: 30 },
  passwordResetRequest: { limit: 5, windowSeconds: 900, ipLimit: 15 },
  passwordReset: { limit: 10, windowSeconds: 900, ipLimit: 30 },
} as const;

export class RateLimitExceeded extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many attempts. Please wait a moment and try again.');
    this.name = 'RateLimitExceeded';
    this.retryAfterSeconds = Math.max(1, retryAfterSeconds);
  }
}

export interface RateLimitInput {
  scope: string;
  identity: string;
  limit: number;
  windowSeconds: number;
  executor?: DbOrTx;
}

export function rateLimitKey(scope: string, identity: string): string {
  const normalizedScope = scope.trim().slice(0, 80);
  const normalizedIdentity = identity.trim().slice(0, 140);
  const key = `${normalizedScope}:${normalizedIdentity}`;
  return key.slice(0, MAX_KEY_LENGTH);
}

/**
 * Atomically consume one token from a database-backed fixed window.
 *
 * The counter is intentionally incremented even when the request is rejected. This
 * prevents an attacker from hovering just below the threshold by retrying rejected
 * requests and makes the guard safe under concurrent claims/bids.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<void> {
  if (!Number.isInteger(input.limit) || input.limit < 1) throw new Error('Invalid rate-limit limit');
  if (!Number.isInteger(input.windowSeconds) || input.windowSeconds < 1) {
    throw new Error('Invalid rate-limit window');
  }

  const key = rateLimitKey(input.scope, input.identity);
  if (key === ':') throw new Error('Rate-limit identity is required');

  const executor = input.executor ?? db;
  const result = await executor.execute(sql`
    INSERT INTO "rate_limit_buckets" (
      "key", "window_started_at", "window_expires_at", "hit_count", "updated_at"
    )
    VALUES (
      ${key}, now(), now() + (${input.windowSeconds} * interval '1 second'), 1, now()
    )
    ON CONFLICT ("key") DO UPDATE SET
      "window_started_at" = CASE
        WHEN "rate_limit_buckets"."window_expires_at" <= now() THEN now()
        ELSE "rate_limit_buckets"."window_started_at"
      END,
      "window_expires_at" = CASE
        WHEN "rate_limit_buckets"."window_expires_at" <= now()
          THEN now() + (${input.windowSeconds} * interval '1 second')
        ELSE "rate_limit_buckets"."window_expires_at"
      END,
      "hit_count" = CASE
        WHEN "rate_limit_buckets"."window_expires_at" <= now() THEN 1
        ELSE LEAST("rate_limit_buckets"."hit_count" + 1, 2147483647)
      END,
      "updated_at" = now()
    RETURNING
      "hit_count",
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("window_expires_at" - now())))::int) AS "retry_after_seconds"
  `);

  const row = result.rows[0] as
    | { hit_count?: number | string; retry_after_seconds?: number | string }
    | undefined;
  const hitCount = Number(row?.hit_count ?? 0);
  if (hitCount > input.limit) {
    throw new RateLimitExceeded(Number(row?.retry_after_seconds ?? input.windowSeconds));
  }
}

export async function enforceUserAndIpRateLimit(
  scope: string,
  userId: string,
  rule: Omit<RateLimitInput, 'scope' | 'identity' | 'executor'>,
): Promise<void> {
  const request = await requestHeaders();
  await Promise.all([
    enforceRateLimit({ scope: `${scope}:user`, identity: userId, ...rule }),
    enforceRateLimit({
      scope: `${scope}:ip`,
      identity: clientAddress(request),
      limit: rule.limit * 3,
      windowSeconds: rule.windowSeconds,
    }),
  ]);
}

export async function enforceAuthRateLimit(
  scope: string,
  identity: string | undefined,
  rule: { limit: number; windowSeconds: number; ipLimit: number },
): Promise<void> {
  const request = await requestHeaders();
  const checks = [
    enforceRateLimit({
      scope: `auth:${scope}:ip`,
      identity: clientAddress(request),
      limit: rule.ipLimit,
      windowSeconds: rule.windowSeconds,
    }),
  ];

  if (identity !== undefined && identity.trim() !== '') {
    checks.push(enforceRateLimit({
      scope: `auth:${scope}:identity`,
      identity: identity.trim().toLowerCase(),
      limit: rule.limit,
      windowSeconds: rule.windowSeconds,
    }));
  }

  await Promise.all(checks);
}

/** A minimal request-header shape keeps the database limiter usable by the worker. */
export type RequestHeaders = {
  get(name: string): string | null;
};

export function clientAddress(requestHeaders: RequestHeaders): string {
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwarded !== undefined && forwarded !== '') return forwarded;
  const real = requestHeaders.get('x-real-ip')?.trim();
  if (real !== undefined && real !== '') return real;
  return 'unknown';
}

export async function requestHeaders(): Promise<RequestHeaders> {
  // Keep the Next request API out of the worker's module-load path. The worker
  // imports this module for bucket cleanup but never has a request context.
  const { headers } = await import('next/headers');
  return headers();
}

export async function pruneExpiredRateLimitBuckets(executor: DbOrTx = db): Promise<void> {
  await executor.execute(sql`
    DELETE FROM "rate_limit_buckets"
    WHERE "window_expires_at" < now() - interval '1 hour'
  `);
}
