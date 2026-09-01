'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { parseMoneyInput } from '@/domain/money';
import { currentUser } from '@/lib/session';
import { updateListingBasics } from '@/services/listings';

const money = (formData: FormData): number | undefined => {
  const raw = String(formData.get('price') ?? '').trim();
  return raw === '' ? undefined : parseMoneyInput(raw) ?? undefined;
};

export async function updateListingAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  try {
    await updateListingBasics(user.userId, listingId, {
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? '') || undefined,
      priceCents: money(formData),
      imageIds: formData.getAll('imageIds').map(String),
    });
    redirect(`/listings/${listingId}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' | ');
      redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(detail)}`);
    }
    if (error instanceof Error) {
      redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
}
