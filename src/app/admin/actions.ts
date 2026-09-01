'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { currentUser } from '@/lib/session';
import { setFullServiceDeliveryDays } from '@/services/platform-settings';

export async function updateDeliveryDefaultsAction(formData: FormData): Promise<void> {
  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in?callbackURL=/admin');

  const profile = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, viewer.userId))
    .limit(1);
  if (profile[0]?.role !== 'admin') redirect('/admin');

  const days = Number(formData.get('fullServiceDeliveryDays') ?? NaN);
  if (!Number.isInteger(days) || days < 1 || days > 60) redirect('/admin?settingsError=days#settings');

  await setFullServiceDeliveryDays(days, viewer.userId);
  redirect('/admin?settings=saved#settings');
}
