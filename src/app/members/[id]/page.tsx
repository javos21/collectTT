import { notFound } from 'next/navigation';
import Link from 'next/link';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { Package } from 'lucide-react';

import { db } from '@/db/client';
import { profiles, reputationCounters } from '@/db/schema/profiles';
import { listings } from '@/db/schema/listings';
import { transactions } from '@/db/schema/transactions';
import { HomeListingTile, type HomeListingRow } from '@/app/home-listing-carousel';
import { currentUser } from '@/lib/session';
import { reportAccountAction } from './actions';
import { ShareListingsButton } from '@/components/share-listings-button';

export const dynamic = 'force-dynamic';

/**
 * The public trust surface. Deliberately shows denominators — "paid on time 3 / 3"
 * reads honestly for a newcomer in a way "100%" does not, and cold-start trust is the
 * hardest problem this platform has.
 */
export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ reported?: string; error?: string }> }) {
  const { id } = await params;
  const viewer = await currentUser();
  const flash = await searchParams;

  const rows = await db
    .select({
      displayName: profiles.displayName,
      memberSince: profiles.memberSince,
      area: profiles.area,
      counters: reputationCounters,
    })
    .from(profiles)
    .leftJoin(reputationCounters, eq(reputationCounters.userId, profiles.userId))
    .where(eq(profiles.userId, id))
    .limit(1);

  const row = rows[0];
  if (row === undefined) notFound();

  const c = row.counters;

  const [theirListings, listingCountRows, successfulAuctionRows] = await Promise.all([
    db
      .select({
        id: listings.id,
        title: listings.title,
        primaryImageId: sql<string | null>`(
          select i.id
          from listing_images li
          inner join images i on i.id = li.image_id
          where li.listing_id = ${listings.id}
          order by li.position asc
          limit 1
        )`,
        saleType: listings.saleType,
        currentBidCents: listings.currentBidCents,
        startBidCents: listings.startBidCents,
        priceCents: listings.priceCents,
        endsAt: listings.endsAt,
        acceptsOffers: listings.acceptsOffers,
      })
      .from(listings)
      .where(and(eq(listings.sellerId, id), eq(listings.status, 'active')))
      .orderBy(desc(listings.publishedAt))
      .limit(12),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(listings)
      .where(and(eq(listings.sellerId, id), eq(listings.status, 'active'))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(
        or(eq(transactions.buyerId, id), eq(transactions.sellerId, id)),
        eq(transactions.state, 'completed'),
        sql`${transactions.source} in ('auction_win', 'auction_runner_up')`,
      )),
  ]);

  const completed = (c?.buyCompleted ?? 0) + (c?.sellCompleted ?? 0);
  const claims = c?.buyClaimsTotal ?? 0;
  const paidOnTime = c?.buyPaidOnTime ?? 0;
  const paidOnTimePurchases = `${paidOnTime} / ${claims}`;
  const successfulAuctions = Number(successfulAuctionRows[0]?.count ?? 0);
  const activeListingCount = Number(listingCountRows[0]?.count ?? 0);

  const initials = row.displayName
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'C';
  const homeListingRows: HomeListingRow[] = theirListings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    primaryImageId: listing.primaryImageId,
    saleType: listing.saleType,
    currentBidCents: listing.currentBidCents,
    startBidCents: listing.startBidCents,
    priceCents: listing.priceCents,
    endsAt: listing.endsAt?.toISOString() ?? null,
    acceptsOffers: listing.acceptsOffers,
    liveClaimCount: 0,
  }));

  return (
    <main className="member-page">
      <section className="member-hero" aria-labelledby="member-name">
        <div className="member-hero__identity">
          <div className="member-avatar" aria-hidden="true">{initials}</div>
          <div>
            <h1 id="member-name">{row.displayName}</h1>
            <p className="member-meta">
              Member since {row.memberSince.toLocaleDateString('en-TT')}
              {row.area !== null && <><span aria-hidden="true"> · </span>{row.area}</>}
            </p>
          </div>
        </div>
      </section>

      {flash.reported === '1' && <p className="alert alert--info" role="status">Thanks — your report was sent privately to CollectTT support.</p>}
      {flash.error !== undefined && <p className="alert alert--error" role="alert">{flash.error}</p>}

      {viewer !== null && viewer.userId !== id && (
        <section className="member-section" aria-labelledby="report-member-heading">
          <h2 id="report-member-heading">Report an account</h2>
          <p className="member-meta">Reports are private and reviewed by CollectTT support. The member will not see who submitted one.</p>
          <form className="buybox__form" action={reportAccountAction}>
            <input type="hidden" name="memberId" value={id} />
            <label htmlFor="report-account-category">Category</label>
            <select id="report-account-category" name="category" required defaultValue=""><option value="" disabled>Select a category</option><option value="account_safety">Safety or identity</option><option value="other">Something else</option></select>
            <label htmlFor="report-account-detail">What should support review?</label>
            <textarea id="report-account-detail" name="detail" minLength={10} maxLength={4000} rows={4} required />
            <button className="secondary" type="submit">Send private report</button>
          </form>
        </section>
      )}

      <section className="member-section member-section--trust" aria-labelledby="trust-heading">
        <div className="member-section__heading">
          <div>
            <h2 id="trust-heading">Trust snapshot</h2>
          </div>
          <span className="member-section__count">{completed} completed</span>
        </div>
        <div className="member-metrics">
          <div className="member-metric member-metric--primary">
            <strong>{completed}</strong>
            <span>Completed deals</span>
          </div>
          <div className="member-metric member-metric--blue">
            <strong>{c?.buyCompleted ?? 0}</strong>
            <span>Purchases</span>
          </div>
          <div className="member-metric member-metric--purple">
            <strong>{c?.sellCompleted ?? 0}</strong>
            <span>Sales</span>
          </div>
          <div className="member-metric member-metric--green">
            <strong>{paidOnTimePurchases}</strong>
            <span>Paid on time / purchases</span>
          </div>
          <div className="member-metric member-metric--purple">
            <strong>{successfulAuctions}</strong>
            <span>Successful auctions</span>
          </div>
        </div>
        <div className="member-reliability" aria-label="Recent reliability signals">
          <div>
            <span>Unpaid claims</span>
            <strong>{c?.buyReneged90d ?? 0}</strong>
            <small>Last 90 days</small>
          </div>
          <div>
            <span>Undelivered sales</span>
            <strong>{c?.sellReneged90d ?? 0}</strong>
            <small>Last 90 days</small>
          </div>
        </div>
      </section>

      <section className="member-section member-section--listings" aria-labelledby="listings-heading">
        <div className="member-section__heading">
          <div>
            <h2 id="listings-heading">Active listings</h2>
          </div>
          <div className="member-section__actions">
            <span className="member-section__count">{activeListingCount} listed</span>
            {activeListingCount > 0 && (
              <>
                <Link href={`/listings?seller=${encodeURIComponent(id)}`}>Search all listings</Link>
                <ShareListingsButton path={`/listings?seller=${encodeURIComponent(id)}`} sellerName={row.displayName} />
              </>
            )}
          </div>
        </div>
      {theirListings.length === 0 ? (
        <div className="member-empty"><Package size={21} aria-hidden="true" /><span>Nothing listed right now.</span></div>
      ) : (
        <div className="home-listing-grid member-home-listing-grid">
          {homeListingRows.map((row) => <HomeListingTile key={row.id} row={row} />)}
        </div>
      )}
      </section>
    </main>
  );
}
