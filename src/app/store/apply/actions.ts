'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import {
  STORE_APPLICATION_TERMS_VERSION,
} from '@/domain/stores/application';
import { currentUser } from '@/lib/session';
import { createStoreApplication, latestStoreApplicationFor } from '@/services/store-applications';

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);

const applicationSchema = z.object({
  storeName: z.string().trim().min(2).max(120),
  addressLine1: z.string().trim().min(3).max(180),
  addressLine2: z.string().trim().max(180).optional(),
  area: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(80),
  phoneE164: z.string().trim().min(7).max(30),
  websiteUrl: optionalUrl,
  instagramUrl: optionalUrl,
  facebookUrl: optionalUrl,
  tiktokUrl: optionalUrl,
  acceptTerms: z.literal(true),
});

function value(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

export async function applyForStoreAction(formData: FormData): Promise<string | null> {
  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in?returnTo=/store/apply');

  const parsed = applicationSchema.safeParse({
    storeName: value(formData, 'storeName'),
    addressLine1: value(formData, 'addressLine1'),
    addressLine2: value(formData, 'addressLine2') || undefined,
    area: value(formData, 'area'),
    city: value(formData, 'city'),
    country: value(formData, 'country') || 'Trinidad and Tobago',
    phoneE164: value(formData, 'phoneE164'),
    websiteUrl: value(formData, 'websiteUrl'),
    instagramUrl: value(formData, 'instagramUrl'),
    facebookUrl: value(formData, 'facebookUrl'),
    tiktokUrl: value(formData, 'tiktokUrl'),
    acceptTerms: formData.get('acceptTerms') === 'on',
  });

  if (!parsed.success) {
    return 'Check the required fields and accept the Store responsibilities.';
  }

  const hasPublicLink = Boolean(
    parsed.data.websiteUrl || parsed.data.instagramUrl || parsed.data.facebookUrl || parsed.data.tiktokUrl,
  );
  if (!hasPublicLink) {
    return 'Add at least one public website or social link so we can verify the Store.';
  }

  const existing = await latestStoreApplicationFor(viewer.userId);
  if (existing?.status === 'pending' || existing?.status === 'confirmed') {
    return 'You already have an active Store application.';
  }

  try {
    await createStoreApplication(viewer.userId, {
      ...parsed.data,
      termsVersion: STORE_APPLICATION_TERMS_VERSION,
    });
  } catch {
    return 'We could not submit that application. Please try again.';
  }

  revalidatePath('/store/apply');
  revalidatePath('/store');
  redirect('/store/apply?submitted=1');
}
