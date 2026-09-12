import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { currentUser, type CurrentUser } from '@/lib/session';

export interface AdminAccess {
  viewer: CurrentUser | null;
  isAdmin: boolean;
}

/** Read the current viewer's platform-admin access once per request. */
export async function adminAccess(): Promise<AdminAccess> {
  const viewer = await currentUser();
  if (viewer === null) return { viewer: null, isAdmin: false };

  const profile = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, viewer.userId))
    .limit(1);

  return { viewer, isAdmin: profile[0]?.role === 'admin' };
}

/** Strict server-side guard for admin pages and server actions. */
export async function requireAdmin(callbackURL = '/admin'): Promise<CurrentUser> {
  const access = await adminAccess();
  if (access.viewer === null) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`);
  }
  if (!access.isAdmin) redirect('/admin');
  return access.viewer;
}
