'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { currentUser } from '@/lib/session';
import { claimListing } from '@/db/atomic/claim-listing';
import { placeBid } from '@/db/atomic/place-bid';
import { parseMoneyInput } from '@/domain/money';
import { acceptOffer, rejectOffer, submitOffer } from '@/services/offers';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

export async function claimAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const deliveryOptionId = String(formData.get('deliveryOptionId') ?? '');
  const settlementMethod = String(formData.get('settlementMethod') ?? '');
  const storeIdRaw = String(formData.get('relayStoreId') ?? '');
  const relayStoreId = storeIdRaw === '' ? null : storeIdRaw;

  if (deliveryOptionId === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a delivery option')}`);
  }
  if (settlementMethod === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a payment method')}`);
  }

  try {
    await claimListing({
      listingId,
      claimantId: user.userId,
      deliveryOptionId,
      settlementMethod,
      relayStoreId,
    });
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/listings/${listingId}`);
  redirect(`/listings/${listingId}?claimed=1`);
}

export async function cancelOfferAndClaimAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const offerId = String(formData.get('offerId') ?? '');
  if (offerId === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('This offer could not be cancelled')}`);
  }

  try {
    await claimListing({
      listingId,
      claimantId: user.userId,
      cancelPendingOfferId: offerId,
    });
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/listings/${listingId}`);
  redirect(`/listings/${listingId}?claimed=1`);
}

export async function bidAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const amountCents = parseMoneyInput(String(formData.get('amount') ?? ''));

  if (amountCents === null || amountCents <= 0) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Enter a valid amount')}`);
  }

  const deliveryOptionId = String(formData.get('deliveryOptionId') ?? '');
  const settlementMethod = String(formData.get('settlementMethod') ?? '');
  const storeIdRaw = String(formData.get('relayStoreId') ?? '');

  if (deliveryOptionId === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a delivery option')}`);
  }
  if (settlementMethod === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a payment method')}`);
  }

  let result;
  try {
    result = await placeBid({
      listingId,
      bidderId: user.userId,
      amountCents,
      deliveryOptionId,
      settlementMethod,
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

export async function submitOfferAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const amountCents = parseMoneyInput(String(formData.get('offerAmount') ?? ''));
  const deliveryOptionId = String(formData.get('offerDeliveryOptionId') ?? formData.get('deliveryOptionId') ?? '');
  const settlementMethod = String(formData.get('offerSettlementMethod') ?? formData.get('settlementMethod') ?? '');
  const storeIdRaw = String(formData.get('offerRelayStoreId') ?? formData.get('relayStoreId') ?? '');

  if (amountCents === null || amountCents <= 0) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Enter a valid offer amount')}`);
  }
  if (deliveryOptionId === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a delivery option')}`);
  }
  if (settlementMethod === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a payment method')}`);
  }

  try {
    await submitOffer({
      listingId,
      buyerId: user.userId,
      amountCents,
      deliveryOptionId,
      settlementMethod,
      relayStoreId: storeIdRaw === '' ? null : storeIdRaw,
    });
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/listings/${listingId}`);
  redirect(`/listings/${listingId}?offer=sent`);
}

export async function acceptOfferAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const offerId = String(formData.get('offerId') ?? '');

  try {
    const result = await acceptOffer(offerId, user.userId);
    revalidatePath(`/listings/${listingId}`);
    redirect(`/deals/${result.transactionId}`);
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }
}

export async function rejectOfferAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const offerId = String(formData.get('offerId') ?? '');

  try {
    await rejectOffer(offerId, user.userId);
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/listings/${listingId}`);
  redirect(`/listings/${listingId}?offer=rejected`);
}
