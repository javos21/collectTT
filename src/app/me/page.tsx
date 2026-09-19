import { desc, eq, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { bids, claims, listings } from '@/db/schema/listings';
import { users } from '@/db/schema/auth';
import { profiles } from '@/db/schema/profiles';
import { signOutAction } from '@/app/auth-actions';
import { db } from '@/db/client';
import { offers } from '@/db/schema/offers';
import { reputationCounters, reputationEvents } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { formatMoney } from '@/domain/money';
import { currentUser } from '@/lib/session';
import { cancelListing, listingsBySeller, saveSellerMarketplacePreferences, saveSellerMeetupLocation, sellerMarketplacePreferencesFor, sellerMeetupLocationsFor } from '@/services/listings';
import { listMarketplaceOptions } from '@/services/platform-settings';
import ProfilePage from './profile-page';
import { updatePrivatePhoneNumber } from '@/services/account-profile';
import { notificationPreferencesFor, saveNotificationPreferences } from '@/services/notification-preferences';
import { OPTIONAL_NOTIFICATION_PREFERENCES } from '@/notifications/events';
import { listRelayStores } from '@/services/relay-stores';

export const dynamic = 'force-dynamic';

async function deleteListingAction(formData: FormData): Promise<void> {
  'use server';
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const listingId = String(formData.get('listingId') ?? '');
  try {
    await cancelListing(user.userId, listingId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete this listing.';
    redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/me');
  redirect('/me');
}

async function savePhoneNumberAction(formData: FormData): Promise<void> {
  'use server';
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  try {
    await updatePrivatePhoneNumber(user.userId, String(formData.get('phone') ?? ''));
  } catch (error) {
    redirect(`/me?tab=account&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not save the mobile number.')}`);
  }
  revalidatePath('/me');
  redirect('/me?tab=account&success=Mobile number saved.');
}

async function saveMeetupLocationAction(formData: FormData): Promise<void> {
  'use server';
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  try {
    await saveSellerMeetupLocation(user.userId, {
      id: String(formData.get('locationId') ?? '').trim() || undefined,
      label: String(formData.get('label') ?? ''),
      area: String(formData.get('area') ?? ''),
      instructions: String(formData.get('instructions') ?? '') || null,
      active: formData.get('active') !== 'false',
    });
  } catch (error) {
    redirect(`/me?tab=account&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not save meetup location.')}`);
  }
  revalidatePath('/me');
  redirect('/me?tab=account&success=Meetup location saved.');
}

async function saveSellerDefaultsAction(formData: FormData): Promise<void> {
  'use server';
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  try {
    await saveSellerMarketplacePreferences(user.userId, {
      defaultDeliveryOptionIds: formData.getAll('defaultDeliveryOptionIds').map(String),
      defaultRelayStoreIds: formData.getAll('defaultRelayStoreIds').map(String),
      defaultPaymentMethods: formData.getAll('defaultPaymentMethods').map(String),
    });
  } catch (error) {
    redirect(`/me?tab=account&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not save seller defaults.')}`);
  }
  revalidatePath('/me');
  redirect('/me?tab=account&success=Seller defaults saved.');
}

async function saveNotificationPreferencesAction(formData: FormData): Promise<void> {
  'use server';
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  try {
    await saveNotificationPreferences(user.userId, OPTIONAL_NOTIFICATION_PREFERENCES.map(({ eventType }) => ({
      eventType,
      emailEnabled: formData.get(`email:${eventType}`) === 'on',
    })));
  } catch (error) {
    redirect(`/me?tab=account&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not save notification preferences.')}`);
  }
  revalidatePath('/me');
  redirect('/me?tab=account&success=Notification preferences saved.');
}

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string; success?: string }> }) {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const params = await searchParams;

  const [identityRows, countersRows, sellerListings, claimRows, bidRows, offerRows, dealRows, reputationEventRows, meetupLocations, sellerPreferences, deliveryOptions, relayStores, notificationPreferences] =
    await Promise.all([
      db.select({ accountName: users.name, displayName: profiles.displayName, phoneE164: profiles.phoneE164 })
        .from(users).innerJoin(profiles, eq(profiles.userId, users.id)).where(eq(users.id, user.userId)).limit(1),
      db.select().from(reputationCounters).where(eq(reputationCounters.userId, user.userId)).limit(1),
      listingsBySeller(user.userId),
      db
        .select({ claim: claims, title: listings.title })
        .from(claims)
        .innerJoin(listings, eq(listings.id, claims.listingId))
        .where(eq(claims.claimantId, user.userId))
        .orderBy(desc(claims.claimedAt))
        .limit(30),
      db
        .select({ bid: bids, title: listings.title })
        .from(bids)
        .innerJoin(listings, eq(listings.id, bids.listingId))
        .where(eq(bids.bidderId, user.userId))
        .orderBy(desc(bids.placedAt))
        .limit(30),
      db
        .select({ offer: offers, title: listings.title })
        .from(offers)
        .innerJoin(listings, eq(listings.id, offers.listingId))
        .where(eq(offers.buyerId, user.userId))
        .orderBy(desc(offers.createdAt))
        .limit(30),
      db
        .select({ transaction: transactions, title: listings.title })
        .from(transactions)
        .innerJoin(listings, eq(listings.id, transactions.listingId))
        .where(or(eq(transactions.buyerId, user.userId), eq(transactions.sellerId, user.userId)))
        .orderBy(desc(transactions.createdAt))
        .limit(50),
      db
        .select({
          event: reputationEvents,
          title: listings.title,
          transactionAmountCents: transactions.amountCents,
          transactionBuyerId: transactions.buyerId,
          transactionSellerId: transactions.sellerId,
        })
        .from(reputationEvents)
        .leftJoin(transactions, eq(transactions.id, reputationEvents.transactionId))
        .leftJoin(listings, eq(listings.id, transactions.listingId))
        .where(eq(reputationEvents.userId, user.userId))
        .orderBy(desc(reputationEvents.occurredAt))
        .limit(30),
      sellerMeetupLocationsFor(user.userId),
      sellerMarketplacePreferencesFor(user.userId),
      listMarketplaceOptions('delivery', { activeOnly: true }),
      listRelayStores(db),
      notificationPreferencesFor(user.userId),
    ]);

  const counters = countersRows[0];
  const identity = identityRows[0];
  if (identity === undefined) throw new Error('Account profile not found');
  return (
    <main className="profile-page">
      <ProfilePage
        signOutAction={signOutAction}
        deleteListingAction={deleteListingAction}
        initialTab={params.tab}
        counters={counters === undefined ? null : {
          buyClaimsTotal: counters.buyClaimsTotal,
          buyCompleted: counters.buyCompleted,
          buyRenegedTotal: counters.buyRenegedTotal,
          buyPaidOnTime: counters.buyPaidOnTime,
          sellCompleted: counters.sellCompleted,
          sellRenegedTotal: counters.sellRenegedTotal,
        }}
        listings={sellerListings.map((listing) => ({
          id: listing.id,
          title: listing.title,
          category: listing.category,
          saleType: listing.saleType,
          status: listing.status,
          claimCount: listing.liveClaimCount,
          bidCount: listing.liveBidCount,
          activeTransactionCount: listing.activeTransactionCount,
          amount: formatMoney(listing.saleType === 'auction'
            ? (listing.currentBidCents ?? listing.startBidCents ?? 0)
            : (listing.priceCents ?? 0)),
        }))}
        claims={claimRows.map(({ claim, title }) => ({
          id: claim.id,
          title,
          status: claim.status,
          transactionId: claim.transactionId,
          fulfillmentPath: claim.fulfillmentPath,
          claimedAt: claim.claimedAt.toISOString(),
        }))}
        bids={bidRows.map(({ bid, title }) => ({
          id: bid.id,
          title,
          amount: formatMoney(bid.amountCents),
          status: bid.status,
          placedAt: bid.placedAt.toISOString(),
        }))}
        offers={offerRows.map(({ offer, title }) => ({
          id: offer.id,
          title,
          amount: formatMoney(offer.amountCents),
          status: offer.status,
          createdAt: offer.createdAt.toISOString(),
        }))}
        reputationEvents={reputationEventRows.map(({ event, title, transactionAmountCents, transactionBuyerId, transactionSellerId }) => ({
          id: event.id,
          type: event.type,
          title,
          occurredAt: event.occurredAt.toISOString(),
          transactionId: event.transactionId,
          amount: event.transactionId === null || transactionAmountCents === null ? null : formatMoney(transactionAmountCents),
          role: event.transactionId === null ? null : (transactionBuyerId === user.userId ? 'Buyer' : transactionSellerId === user.userId ? 'Seller' : null),
        }))}
        deals={dealRows.map(({ transaction, title }) => ({
          id: transaction.id,
          title,
          role: transaction.buyerId === user.userId ? 'Buyer' : 'Seller',
          amount: formatMoney(transaction.amountCents),
          state: transaction.state,
          fulfillmentPath: transaction.fulfillmentPath,
          createdAt: transaction.createdAt.toISOString(),
          completedAt: iso(transaction.completedAt),
        }))}
        identity={{
          userId: user.userId,
          accountName: identity.accountName,
          displayName: identity.displayName,
          email: user.email,
          phoneE164: identity.phoneE164,
        }}
        feedback={{ error: params.error, success: params.success }}
        savePhoneNumberAction={savePhoneNumberAction}
        deliveryOptions={deliveryOptions.map((option) => ({ id: option.id, key: option.key, label: option.label, description: option.description, requiresStore: option.requiresStore }))}
        relayStores={relayStores.map((store) => ({ id: store.id, name: store.name, area: store.area }))}
        meetupLocations={meetupLocations.map((location) => ({ id: location.id, label: location.label, area: location.area, instructions: location.instructions, active: location.active }))}
        sellerPreferences={{ defaultDeliveryOptionIds: sellerPreferences.defaultDeliveryOptionIds, defaultRelayStoreIds: sellerPreferences.defaultRelayStoreIds, defaultPaymentMethods: sellerPreferences.defaultPaymentMethods }}
        saveMeetupLocationAction={saveMeetupLocationAction}
        saveSellerDefaultsAction={saveSellerDefaultsAction}
        notificationPreferences={notificationPreferences}
        saveNotificationPreferencesAction={saveNotificationPreferencesAction}
      />
    </main>
  );
}
