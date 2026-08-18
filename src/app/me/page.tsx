import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { currentUser } from '@/lib/session';
import { auth } from '@/lib/auth';
import { listingsBySeller } from '@/services/listings';
import { db } from '@/db/client';
import { reputationCounters } from '@/db/schema/profiles';
import { objectiveSummary } from '@/domain/policy/reputation';
import { formatMoney } from '@/domain/money';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

async function signOut(): Promise<void> {
  'use server';
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}

export default async function MePage() {
  const user = await currentUser();
  if (user === null) redirect('/sign-in');

  const [listings, counters] = await Promise.all([
    listingsBySeller(user.userId),
    db.select().from(reputationCounters).where(eq(reputationCounters.userId, user.userId)).limit(1),
  ]);

  const c = counters[0];

  return (
    <main>
      <h1>{user.displayName}</h1>
      <p className="muted">
        @{user.handle} · {user.email}
      </p>

      <h2>Objective record</h2>
      {c === undefined ? (
        <p className="muted">No activity yet.</p>
      ) : (
        <ul>
          {objectiveSummary({
            buyCompleted: c.buyCompleted,
            buyClaimsTotal: c.buyClaimsTotal,
            buyPaidOnTime: c.buyPaidOnTime,
            sellCompleted: c.sellCompleted,
          }).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p className="muted">
        Hard counters, kept separate from star ratings. These are what trigger automatic
        restrictions — opinions never do.
      </p>

      <h2>My listings</h2>
      {listings.length === 0 ? (
        <p className="muted">
          None yet. <Link href="/listings/new">Create one</Link>.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Type</th>
              <th>Price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <tr key={listing.id}>
                <td>
                  <Link href={`/listings/${listing.id}`}>{listing.title}</Link>
                </td>
                <td>{listing.category}</td>
                <td>{listing.saleType === 'auction' ? 'auction' : 'sale'}</td>
                <td>
                  {formatMoney(
                    listing.saleType === 'auction'
                      ? (listing.currentBidCents ?? listing.startBidCents ?? 0)
                      : (listing.priceCents ?? 0),
                  )}
                </td>
                <td>{listing.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={signOut}>
        <button className="secondary" type="submit">
          Sign out
        </button>
      </form>
    </main>
  );
}
