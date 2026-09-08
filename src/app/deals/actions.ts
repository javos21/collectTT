'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { currentUser } from '@/lib/session';
import { acceptOffer, rejectOffer } from '@/services/offers';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export async function acceptReceivedOfferAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const offerId = String(formData.get('offerId') ?? '');
  const listingId = String(formData.get('listingId') ?? '');
  let transactionId: string;

  try {
    transactionId = (await acceptOffer(offerId, user.userId)).transactionId;
  } catch (error) {
    redirect(`/deals?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath('/deals');
  revalidatePath('/me');
  revalidatePath(`/listings/${listingId}`);
  redirect(`/deals/${transactionId}`);
}

export async function rejectReceivedOfferAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const offerId = String(formData.get('offerId') ?? '');
  const listingId = String(formData.get('listingId') ?? '');

  try {
    await rejectOffer(offerId, user.userId);
  } catch (error) {
    redirect(`/deals?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath('/deals');
  revalidatePath('/me');
  revalidatePath(`/listings/${listingId}`);
  redirect('/deals?offer=rejected');
}
