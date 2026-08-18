/**
 * Session helpers for server components and server actions.
 *
 * `ensureProfile` lazily creates the domain profile the first time an authenticated
 * user shows up. Auth identity and domain identity are separate tables on purpose
 * (see src/db/schema/profiles.ts) and this is the seam that joins them.
 */

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';

import { auth } from './auth';
import { db } from '../db/client';
import { profiles, reputationCounters } from '../db/schema/profiles';

export interface CurrentUser {
  userId: string;
  email: string;
  displayName: string;
  handle: string;
}

export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session === null) return null;

  const profile = await ensureProfile(session.user.id, session.user.email, session.user.name);
  return {
    userId: session.user.id,
    email: session.user.email,
    displayName: profile.displayName,
    handle: profile.handle,
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (user === null) throw new Error('Sign in required');
  return user;
}

async function ensureProfile(userId: string, email: string, name: string | null | undefined) {
  const existing = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const found = existing[0];
  if (found !== undefined) return found;

  // Better Auth sets `name` to an EMPTY STRING for magic-link signups (there is no
  // name to collect), so `?? fallback` never fires. Check for blank, not just null.
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
