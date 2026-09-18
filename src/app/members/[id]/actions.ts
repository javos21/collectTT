'use server';

import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { eq } from 'drizzle-orm';
import { enforceUserAndIpRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { currentUser } from '@/lib/session';
import { createSupportCase } from '@/services/support-cases';

export async function reportAccountAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const memberId = String(formData.get('memberId') ?? '');
  const category = String(formData.get('category') ?? '').trim();
  const detail = String(formData.get('detail') ?? '').trim();
  if (memberId === user.userId) redirect(`/members/${memberId}?error=You+cannot+report+your+own+account.`);
  if (!['account_safety', 'other'].includes(category) || detail.length < 10 || detail.length > 4000) {
    redirect(`/members/${memberId}?error=Choose+a+category+and+describe+the+issue+in+10+to+4%2C000+characters.`);
  }
  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    await db.transaction(async (tx) => {
      const target = await tx.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.userId, memberId)).limit(1);
      if (target[0] === undefined) throw new Error('Member not found.');
      await createSupportCase({
        tx,
        targetType: 'account',
        targetId: memberId,
        reporterUserId: user.userId,
        category: category as 'account_safety' | 'other',
        detail,
      });
    });
  } catch (error) {
    redirect(`/members/${memberId}?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not send report.')}`);
  }
  redirect(`/members/${memberId}?reported=1`);
}
