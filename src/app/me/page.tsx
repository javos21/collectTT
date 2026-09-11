import { desc, eq, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { bids, claims, listings } from '@/db/schema/listings';
import { signOutAction } from '@/app/auth-actions';
import { db } from '@/db/client';
import { offers } from '@/db/schema/offers';
import { profiles, reputationCounters, reputationEvents } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { formatMoney } from '@/domain/money';
import { objectiveSummary } from '@/domain/policy/reputation';
import { currentUser } from '@/lib/session';
import { cancelListing, listingsBySeller } from '@/services/listings';
import ProfilePage from './profile-page';

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

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');
  const params = await searchParams;

  const [profileRows, countersRows, sellerListings, claimRows, bidRows, offerRows, receivedOfferRows, dealRows, reputationEventRows] =
    await Promise.all([
      db.select().from(profiles).where(eq(profiles.userId, user.userId)).limit(1),
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
        .select({ offer: offers, title: listings.title, buyerName: profiles.displayName })
        .from(offers)
        .innerJoin(listings, eq(listings.id, offers.listingId))
        .innerJoin(profiles, eq(profiles.userId, offers.buyerId))
        .where(eq(listings.sellerId, user.userId))
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
        .select({ event: reputationEvents, title: listings.title })
        .from(reputationEvents)
        .leftJoin(transactions, eq(transactions.id, reputationEvents.transactionId))
        .leftJoin(listings, eq(listings.id, transactions.listingId))
        .where(eq(reputationEvents.userId, user.userId))
        .orderBy(desc(reputationEvents.occurredAt))
        .limit(30),
    ]);

  const profile = profileRows[0];
  const counters = countersRows[0];
  return (
    <main className="profile-page">
      <ProfilePage
        signOutAction={signOutAction}
        deleteListingAction={deleteListingAction}
        initialTab={params.tab}
        profile={{
          displayName: user.displayName,
          handle: user.handle,
          email: user.email,
          image: user.image,
          phoneE164: profile?.phoneE164 ?? null,
          bio: profile?.bio ?? null,
          area: profile?.area ?? null,
          deliveryAddressLine1: profile?.deliveryAddressLine1 ?? null,
          deliveryAddressLine2: profile?.deliveryAddressLine2 ?? null,
          deliveryCity: profile?.deliveryCity ?? null,
          deliveryCountry: profile?.deliveryCountry ?? 'Trinidad and Tobago',
          memberSince: profile?.memberSince.toISOString() ?? new Date().toISOString(),
        }}
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
        receivedOffers={receivedOfferRows.map(({ offer, title, buyerName }) => ({
          id: offer.id,
          title,
          buyerName,
          amount: formatMoney(offer.amountCents),
          status: offer.status,
          createdAt: offer.createdAt.toISOString(),
        }))}
        reputationEvents={reputationEventRows.map(({ event, title }) => ({
          id: event.id,
          type: event.type,
          title,
          occurredAt: event.occurredAt.toISOString(),
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
        objectiveLines={counters === undefined ? [] : objectiveSummary({
          buyCompleted: counters.buyCompleted,
          buyClaimsTotal: counters.buyClaimsTotal,
          buyPaidOnTime: counters.buyPaidOnTime,
          sellCompleted: counters.sellCompleted,
        })}
      />
    </main>
  );
}
