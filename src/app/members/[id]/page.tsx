import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { profiles, reputationCounters, restrictions } from '@/db/schema/profiles';
import { listings } from '@/db/schema/listings';
import { publicRatings } from '@/services/ratings';
import { formatMoney } from '@/domain/money';
import { isNewMember } from '@/domain/policy/reputation';

export const dynamic = 'force-dynamic';

/**
 * The public trust surface. Deliberately shows denominators — "paid on time 3 of 3"
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

  const [theirListings, reviews, activeRestrictions] = await Promise.all([
    db
      .select()
      .from(listings)
      .where(and(eq(listings.sellerId, id), eq(listings.status, 'active')))
      .orderBy(desc(listings.publishedAt))
      .limit(12),
    publicRatings(id),
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

  return (
    <main>
      <h1>{p.displayName}</h1>
      <p className="muted">
        @{p.handle} · member since {p.memberSince.toLocaleDateString('en-TT')}
        {p.area !== null && ` · ${p.area}`}
      </p>

      <h2>Objective record</h2>
      <table>
        <tbody>
          <tr>
            <td>Completed deals</td>
            <td>{completed}</td>
          </tr>
          <tr>
            <td>Paid on time</td>
            <td>
              {claims === 0 ? (
                <span className="muted">no purchases yet</span>
              ) : (
                `${paidOnTime} of ${claims}`
              )}
            </td>
          </tr>
          <tr>
            <td>Unpaid claims (last 90 days)</td>
            <td>{c?.buyReneged90d ?? 0}</td>
          </tr>
          <tr>
            <td>Undelivered sales (last 90 days)</td>
            <td>{c?.sellReneged90d ?? 0}</td>
          </tr>
          <tr>
            <td>Rating</td>
            <td>
              {c?.ratingCount ? (
                <>
                  {Number(c.ratingAvg).toFixed(2)} from {c.ratingCount} rating
                  {c.ratingCount === 1 ? '' : 's'}
                </>
              ) : (
                <span className="muted">not rated yet</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {isNewMember(completed) && (
        <p className="muted">
          New to CollectTT. Sellers can ask newer buyers to pay up front — a lower-risk
          on-ramp, not a closed door.
        </p>
      )}

      {activeRestrictions.length > 0 && (
        <>
          <h2>Current restrictions</h2>
          <ul>
            {activeRestrictions.map((r) => (
              <li key={r.type}>
                <strong>{r.type.replace(/_/g, ' ')}</strong> — {r.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Ratings</h2>
      {reviews.length === 0 ? (
        <p className="muted">No revealed ratings yet.</p>
      ) : (
        <table>
          <tbody>
            {reviews.map((r, i) => (
              <tr key={i}>
                <td>
                  {'★'.repeat(r.stars)}
                  {'☆'.repeat(5 - r.stars)}
                </td>
                <td>{r.comment ?? <span className="muted">no comment</span>}</td>
                <td className="muted">
                  {r.direction === 'buyer_rates_seller' ? 'as seller' : 'as buyer'} ·{' '}
                  {r.submittedAt.toLocaleDateString('en-TT')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Active listings</h2>
      {theirListings.length === 0 ? (
        <p className="muted">Nothing listed right now.</p>
      ) : (
        <div className="grid">
          {theirListings.map((listing) => (
            <div className="card" key={listing.id}>
              <Link href={`/listings/${listing.id}`}>{listing.title}</Link>
              <p style={{ margin: '.25rem 0 0', fontWeight: 600 }}>
                {formatMoney(
                  listing.saleType === 'auction'
                    ? (listing.currentBidCents ?? listing.startBidCents ?? 0)
                    : (listing.priceCents ?? 0),
                )}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
