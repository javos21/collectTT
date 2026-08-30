import { and, desc, eq, or, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { bids, claims, listings } from '@/db/schema/listings';
import { db } from '@/db/client';
import { offers } from '@/db/schema/offers';
import { profiles, ratings, reputationCounters } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { formatMoney } from '@/domain/money';
import { objectiveSummary } from '@/domain/policy/reputation';
import { auth } from '@/lib/auth';
import { currentUser } from '@/lib/session';
import { listingsBySeller } from '@/services/listings';
import ProfilePage from './profile-page';

export const dynamic = 'force-dynamic';

async function signOut(): Promise<void> {
  'use server';
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export default async function MePage() {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const [profileRows, countersRows, sellerListings, claimRows, bidRows, offerRows, dealRows, ratingRows] =
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
        .select({ transaction: transactions, title: listings.title })
        .from(transactions)
        .innerJoin(listings, eq(listings.id, transactions.listingId))
        .where(or(eq(transactions.buyerId, user.userId), eq(transactions.sellerId, user.userId)))
        .orderBy(desc(transactions.createdAt))
        .limit(50),
      db
        .select({ rating: ratings, title: listings.title })
        .from(ratings)
        .innerJoin(transactions, eq(transactions.id, ratings.transactionId))
        .innerJoin(listings, eq(listings.id, transactions.listingId))
        .where(and(eq(ratings.rateeId, user.userId), sql`${ratings.revealedAt} is not null`))
        .orderBy(desc(ratings.submittedAt))
        .limit(30),
    ]);

  const profile = profileRows[0];
  const counters = countersRows[0];
  const ratingAverage = counters?.ratingAvg === null || counters?.ratingAvg === undefined
    ? null
    : Number(counters.ratingAvg);

  return (
    <main className="profile-page">
      <ProfilePage
        signOutAction={signOut}
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
          ratingAverage,
          ratingCount: counters?.ratingCount ?? 0,
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
          amount: formatMoney(listing.saleType === 'auction'
            ? (listing.currentBidCents ?? listing.startBidCents ?? 0)
            : (listing.priceCents ?? 0)),
        }))}
        claims={claimRows.map(({ claim, title }) => ({
          id: claim.id,
          title,
          status: claim.status,
          position: claim.position,
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
        ratings={ratingRows.map(({ rating, title }) => ({
          id: rating.id,
          title,
          stars: rating.stars,
          comment: rating.comment,
          direction: rating.direction,
          submittedAt: rating.submittedAt.toISOString(),
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
