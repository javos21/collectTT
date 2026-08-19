'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { currentUser } from '@/lib/session';
import { claimListing } from '@/db/atomic/claim-listing';
import { placeBid } from '@/db/atomic/place-bid';
import { parseMoneyInput } from '@/domain/money';
import type { FulfillmentPath } from '@/domain/states/transaction';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export async function claimAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const path = String(formData.get('fulfillmentPath') ?? 'cash_meetup') as FulfillmentPath;
  const storeIdRaw = String(formData.get('relayStoreId') ?? '');
  const relayStoreId = storeIdRaw === '' ? null : storeIdRaw;

  let result;
  try {
    result = await claimListing({
      listingId,
      claimantId: user.userId,
      fulfillmentPath: path,
      relayStoreId,
    });
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/listings/${listingId}`);

  if (result.outcome === 'claimed' && result.transactionId !== undefined) {
    redirect(`/deals/${result.transactionId}`);
  }
  redirect(`/listings/${listingId}?queued=${result.position ?? ''}`);
}

export async function bidAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const amountCents = parseMoneyInput(String(formData.get('amount') ?? ''));

  if (amountCents === null || amountCents <= 0) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Enter a valid amount')}`);
  }

  const path = String(formData.get('fulfillmentPath') ?? '') as FulfillmentPath | '';
  const storeIdRaw = String(formData.get('relayStoreId') ?? '');

  let result;
  try {
    result = await placeBid({
      listingId,
      bidderId: user.userId,
      amountCents,
      ...(path !== '' ? { fulfillmentPath: path } : {}),
      relayStoreId: storeIdRaw === '' ? null : storeIdRaw,
    });
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/listings/${listingId}`);

  if (result.transactionId !== undefined) {
    redirect(`/deals/${result.transactionId}`);
  }
  redirect(`/listings/${listingId}?bid=${result.extended ? 'extended' : 'ok'}`);
}
