import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';

const publicDisplayNameSchema = z.string().trim().min(2, 'Display name must be at least 2 characters.').max(80);

/** Normalize Trinidad local numbers and already-international numbers to E.164. */
export function normalizePhoneE164(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  let normalized: string;

  if (trimmed.startsWith('+')) normalized = `+${digits}`;
  else if (digits.length === 7) normalized = `+1868${digits}`;
  else if (digits.length === 10 && digits.startsWith('868')) normalized = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith('1')) normalized = `+${digits}`;
  else throw new Error('Enter a valid phone number, including the country code.');

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error('Enter a valid phone number, including the country code.');
  }
  return normalized;
}

/**
 * The sign-up flow chooses the public name after email verification. Once that
 * initial value is set, members cannot rename themselves from the account API.
 */
export async function setInitialOnboardingProfile(
  userId: string,
  rawDisplayName: string,
  rawPhone: string,
): Promise<void> {
  const parsed = publicDisplayNameSchema.safeParse(rawDisplayName);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Enter a valid display name.');
  const displayName = parsed.data;
  const phoneE164 = normalizePhoneE164(rawPhone);

  await db.transaction(async (tx) => {
    const current = await tx
      .select({ displayName: profiles.displayName, phoneE164: profiles.phoneE164 })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    const profile = current[0];
    if (profile === undefined) throw new Error('Account profile not found.');
    if (profile.displayName === displayName && profile.phoneE164 === phoneE164) return;
    if (profile.displayName !== 'Collector') {
      throw new Error('Onboarding details can only be chosen during account creation.');
    }

    const updated = await tx
      .update(profiles)
      .set({ displayName, phoneE164, updatedAt: sql`now()` })
      .where(and(eq(profiles.userId, userId), eq(profiles.displayName, 'Collector')))
      .returning({ userId: profiles.userId });
    if (updated.length === 0) throw new Error('Onboarding details could not be saved.');
  });
}

export async function updatePrivatePhoneNumber(userId: string, rawPhone: string): Promise<void> {
  const phoneE164 = normalizePhoneE164(rawPhone);
  await db
    .update(profiles)
    .set({ phoneE164, updatedAt: sql`now()` })
    .where(eq(profiles.userId, userId));
}
