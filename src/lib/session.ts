/**
 * Session helpers for server components and server actions.
 *
 * `ensureProfile` lazily creates the domain profile the first time an authenticated
 * user shows up. Auth identity and domain identity are separate tables on purpose
 * (see src/db/schema/profiles.ts) and this is the seam that joins them.
 */

import { cache } from 'react';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

import { auth } from './auth';
import { db } from '../db/client';
import { profiles, reputationCounters } from '../db/schema/profiles';

export interface CurrentUser {
  userId: string;
  email: string;
  image: string | null;
  displayName: string;
  handle: string;
}

/**
 * The root layout and individual pages commonly need the viewer in the same render.
 * React's request-scoped cache prevents each caller from issuing another session and
 * profile lookup while keeping the result isolated between users and requests.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const requestHeaders = await headers();
  let session;
  try {
    session = await getSessionWithRetry(requestHeaders);
  } catch (error) {
    // A browser can retain a session cookie after its database row has expired or
    // been removed. Better Auth surfaces that as an API error; render the request as
    // signed out instead of taking down every public page with a server error overlay.
    if (error instanceof Error && error.message === 'Failed to get session') return null;
    throw error;
  }
  if (session === null) return null;

  const profile = await ensureProfile(session.user.id, session.user.email, session.user.name);
  return {
    userId: session.user.id,
    email: session.user.email,
    image: session.user.image ?? null,
    displayName: profile.displayName,
    handle: profile.handle,
  };
});

/**
 * A dropped pooled connection is usually recoverable on the next checkout. Retry
 * exactly once for connection-level failures; application and authentication errors
 * still surface immediately. The retry is deliberately short so a real outage is not
 * hidden behind a long request.
 */
async function getSessionWithRetry(
  requestHeaders: Awaited<ReturnType<typeof headers>>,
) {
  try {
    return await auth.api.getSession({ headers: requestHeaders });
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return auth.api.getSession({ headers: requestHeaders });
  }
}

const transientDatabaseCodes = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);

function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && transientDatabaseCodes.has(candidate.code)) {
      return true;
    }
    if (
      typeof candidate.message === 'string' &&
      /connection (?:terminated|reset|refused)|socket hang up|network timeout|timed out/i.test(
        candidate.message,
      )
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * ★ A TYPE, not a string. Callers that must turn "no session" into a sign-in redirect
 *   rather than a crash page — the store counter, above all — match on this class.
 *   Matching on `error.message === 'Sign in required'` made a copy-edit of that
 *   sentence silently reintroduce the crash page it exists to prevent.
 */
export class SignInRequiredError extends Error {
  constructor() {
    super('Sign in required');
    this.name = 'SignInRequiredError';
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (user === null) throw new SignInRequiredError();
  return user;
}

async function ensureProfile(userId: string, email: string, name: string | null | undefined) {
  const existing = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const found = existing[0];
  if (found !== undefined) return found;

  // Provider data is not guaranteed to include a useful name. Check for blank rather
  // than only null so every authentication path still creates a usable profile.
  const trimmedName = (name ?? '').trim();
  const base = trimmedName !== '' ? trimmedName : (email.split('@')[0] ?? 'member');
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'member';
  const handle = `${slug}_${userId.slice(0, 6)}`;

  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(profiles)
      .values({ userId, displayName: base, handle })
      .onConflictDoNothing()
      .returning();

    await tx.insert(reputationCounters).values({ userId }).onConflictDoNothing();

    if (rows[0] !== undefined) return rows[0];
    const again = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return again[0];
  });

  if (created === undefined) throw new Error('Failed to create profile');
  return created;
}
