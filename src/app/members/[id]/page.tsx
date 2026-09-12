import { notFound } from 'next/navigation';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { CircleAlert, Package } from 'lucide-react';

import { db } from '@/db/client';
import { profiles, reputationCounters, restrictions } from '@/db/schema/profiles';
import { listings } from '@/db/schema/listings';
import { publicHandle } from '@/lib/profile-display';
import { HomeListingTile, type HomeListingRow } from '@/app/home-listing-carousel';

export const dynamic = 'force-dynamic';

/**
 * The public trust surface. Deliberately shows denominators — "paid on time 3 / 3"
 * reads honestly for a newcomer in a way "100%" does not, and cold-start trust is the
 * hardest problem this platform has.
 */
export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const rows = await db
    .select({ p: profiles, c: reputationCounters })
    .from(profiles)
    .leftJoin(reputationCounters, eq(reputationCounters.userId, profiles.userId))
    .where(eq(profiles.userId, id))
    .limit(1);

  const row = rows[0];
  if (row === undefined) notFound();

  const { p, c } = row;

  const [theirListings, activeRestrictions] = await Promise.all([
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
      .select({ type: restrictions.type, reason: restrictions.reason })
      .from(restrictions)
      .where(
        and(
          eq(restrictions.userId, id),
          isNull(restrictions.liftedAt),
          or(isNull(restrictions.expiresAt), sql`${restrictions.expiresAt} > now()`),
        ),
      ),
  ]);

  const completed = (c?.buyCompleted ?? 0) + (c?.sellCompleted ?? 0);
  const claims = c?.buyClaimsTotal ?? 0;
  const paidOnTime = c?.buyPaidOnTime ?? 0;
  const paidOnTimePurchases = `${paidOnTime} / ${claims}`;

  const initials = p.displayName
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'C';
  const displayHandle = publicHandle(p.handle);
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
            <h1 id="member-name">{p.displayName}</h1>
            <p className="member-meta">
              @{displayHandle} <span aria-hidden="true">·</span> member since {p.memberSince.toLocaleDateString('en-TT')}
              {p.area !== null && <><span aria-hidden="true"> · </span>{p.area}</>}
            </p>
          </div>
        </div>
      </section>

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

      {activeRestrictions.length > 0 && (
        <section className="member-callout member-callout--warning" aria-labelledby="restrictions-heading">
          <div className="member-callout__icon"><CircleAlert size={17} aria-hidden="true" /></div>
          <div>
            <strong id="restrictions-heading">Current account restrictions</strong>
            <ul>
              {activeRestrictions.map((r) => <li key={r.type}><b>{r.type.replace(/_/g, ' ')}</b> — {r.reason}</li>)}
            </ul>
          </div>
        </section>
      )}

      <section className="member-section member-section--listings" aria-labelledby="listings-heading">
        <div className="member-section__heading">
          <div>
            <h2 id="listings-heading">Active listings</h2>
          </div>
          <span className="member-section__count">{theirListings.length} listed</span>
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
