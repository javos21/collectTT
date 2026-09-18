'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { currentUser } from '@/lib/session';
import { enforceUserAndIpRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { claimListing } from '@/db/atomic/claim-listing';
import { markListingSoldOutside, relistListing } from '@/services/listings';
import { placeBid } from '@/db/atomic/place-bid';
import { parseMoneyInput } from '@/domain/money';
import { acceptOffer, rejectOffer, submitOffer } from '@/services/offers';
import { MarketplaceEligibilityError } from '@/services/marketplace-eligibility';
import { ConflictError } from '@/services/transactions';
import { isV1Launch } from '@/lib/launch-scope';
import { acceptAuctionFallbackOffer } from '@/services/transactions';
import { db } from '@/db/client';
import { listings } from '@/db/schema/listings';
import { createSupportCase, isSupportCaseCategory, type SupportCaseCategory } from '@/services/support-cases';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof MarketplaceEligibilityError) return error.code;
  if (error instanceof ConflictError && error.code !== 'conflict') return error.code;
  if (error instanceof Error && error.message.includes('purchase commitment')) return 'commitment_confirmation_required';
  if (error instanceof Error && /just claimed|no longer available/i.test(error.message)) return 'listing_unavailable';
  return undefined;
}

function listingErrorUrl(listingId: string, error: unknown): string {
  const params = new URLSearchParams({ error: message(error) });
  const code = errorCode(error);
  if (code !== undefined) params.set('errorCode', code);
  return `/listings/${listingId}?${params.toString()}`;
}

function optionLabel(): string {
  return isV1Launch() ? 'meetup' : 'delivery';
}

export async function claimAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  const deliveryOptionId = String(formData.get('deliveryOptionId') ?? '');
  const settlementMethod = String(formData.get('settlementMethod') ?? '');
  const storeIdRaw = String(formData.get('relayStoreId') ?? '');
  const relayStoreId = storeIdRaw === '' ? null : storeIdRaw;
  const commitmentAcknowledged = formData.get('commitmentAcknowledged') === 'yes';

  if (deliveryOptionId === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(`Choose a ${optionLabel()} option`)}`);
  }
  if (settlementMethod === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a payment method')}`);
  }
  if (!commitmentAcknowledged) {
    redirect(listingErrorUrl(listingId, new Error('Confirm that this is a purchase commitment before reserving the item.')));
  }

  try {
    await enforceUserAndIpRateLimit('listing:claim', user.userId, RATE_LIMITS.claim);
    await claimListing({
      listingId,
      claimantId: user.userId,
      deliveryOptionId,
      settlementMethod,
      relayStoreId,
      commitmentAcknowledged,
    });
  } catch (error) {
    redirect(listingErrorUrl(listingId, error));
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
    await enforceUserAndIpRateLimit('listing:claim', user.userId, RATE_LIMITS.claim);
    await claimListing({
      listingId,
      claimantId: user.userId,
      cancelPendingOfferId: offerId,
      commitmentAcknowledged: true,
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
    redirect(`/listings/${listingId}?error=${encodeURIComponent(`Choose a ${optionLabel()} option`)}`);
  }
  if (settlementMethod === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a payment method')}`);
  }
  if (formData.get('commitmentAcknowledged') !== 'yes') {
    redirect(listingErrorUrl(listingId, new Error('Confirm that this bid is a binding purchase commitment before bidding.')));
  }

  let result;
  try {
    await enforceUserAndIpRateLimit('listing:bid', user.userId, RATE_LIMITS.bid);
    result = await placeBid({
      listingId,
      bidderId: user.userId,
      amountCents,
      deliveryOptionId,
      settlementMethod,
      relayStoreId: storeIdRaw === '' ? null : storeIdRaw,
      commitmentAcknowledged: true,
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

/** Report a listing or auction without exposing the reporter to the seller. */
export async function reportListingAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const listingId = String(formData.get('listingId') ?? '');
  const category = String(formData.get('category') ?? '').trim();
  const detail = String(formData.get('detail') ?? '').trim();
  if (!isSupportCaseCategory(category) || detail.length < 10 || detail.length > 4000) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a report category and describe the issue in 10 to 4,000 characters.')}`);
  }
  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    await db.transaction(async (tx) => {
      const rows = await tx.select({ saleType: listings.saleType }).from(listings).where(eq(listings.id, listingId)).limit(1);
      const listing = rows[0];
      if (listing === undefined) throw new Error('Listing not found.');
      await createSupportCase({
        tx,
        targetType: listing.saleType === 'auction' ? 'auction' : 'listing',
        targetId: listingId,
        reporterUserId: user.userId,
        category: category as SupportCaseCategory,
        detail,
      });
    });
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(`/listings/${listingId}`);
  redirect(`/listings/${listingId}?reported=1`);
}

export async function acceptFallbackOfferAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const offerId = String(formData.get('offerId') ?? '');
  if (offerId === '') redirect('/listings');
  let result: { transactionId: string };
  try {
    await enforceUserAndIpRateLimit('deal:mutation', user.userId, RATE_LIMITS.transaction);
    result = await db.transaction(async (tx) => acceptAuctionFallbackOffer(tx, offerId, user.userId));
  } catch (error) {
    const listingId = String(formData.get('listingId') ?? '');
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }
  const listingId = String(formData.get('listingId') ?? '');
  revalidatePath(`/listings/${listingId}`);
  redirect(`/deals/${result.transactionId}`);
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
    redirect(`/listings/${listingId}?error=${encodeURIComponent(`Choose a ${optionLabel()} option`)}`);
  }
  if (settlementMethod === '') {
    redirect(`/listings/${listingId}?error=${encodeURIComponent('Choose a payment method')}`);
  }

  try {
    await enforceUserAndIpRateLimit('listing:offer', user.userId, RATE_LIMITS.offer);
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
    await enforceUserAndIpRateLimit('listing:offer', user.userId, RATE_LIMITS.offer);
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
    await enforceUserAndIpRateLimit('listing:offer', user.userId, RATE_LIMITS.offer);
    await rejectOffer(offerId, user.userId);
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }

  revalidatePath(`/listings/${listingId}`);
  redirect(`/listings/${listingId}?offer=rejected`);
}

export async function markSoldOutsideAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const listingId = String(formData.get('listingId') ?? '');
  try {
    await markListingSoldOutside(user.userId, listingId);
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }
  revalidatePath(`/listings/${listingId}`);
  redirect(`/listings/${listingId}`);
}

export async function duplicateListingAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const listingId = String(formData.get('listingId') ?? '');
  redirect(`/listings/new?duplicateFrom=${encodeURIComponent(listingId)}`);
}

export async function relistListingAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const listingId = String(formData.get('listingId') ?? '');
  let draft: { id: string };
  try {
    draft = await relistListing(user.userId, listingId);
  } catch (error) {
    redirect(`/listings/${listingId}?error=${encodeURIComponent(message(error))}`);
  }
  redirect(`/listings/${draft.id}/edit`);
}
