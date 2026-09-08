import { Activity, ClipboardList, Gavel, Users } from 'lucide-react';
import { count, desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { claims, listings } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { currentUser } from '@/lib/session';
import { AdminDenied } from './admin-access';
import { AdminFrame } from './admin-frame';

function displayStatus(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function AdminPage() {
  const viewer = await currentUser();
  if (viewer === null) return <AdminDenied signedIn={false} />;

  const viewerProfile = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, viewer.userId))
    .limit(1);
  if (viewerProfile[0]?.role !== 'admin') return <AdminDenied signedIn />;

  const [userCount, activeListingCount, openTransactionCount, activeClaimCount, recentListings] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(listings).where(eq(listings.status, 'active')),
    db.select({ value: count() }).from(transactions).where(eq(transactions.state, 'open')),
    db.select({ value: count() }).from(claims).where(eq(claims.status, 'active')),
    db
      .select({ id: listings.id, title: listings.title, status: listings.status, saleType: listings.saleType, createdAt: listings.createdAt, sellerName: profiles.displayName })
      .from(listings)
      .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
      .orderBy(desc(listings.createdAt))
      .limit(8),
  ]);

  const stats = [
    { label: 'Members', value: userCount[0]?.value ?? 0, icon: Users, tone: 'purple' },
    { label: 'Active listings', value: activeListingCount[0]?.value ?? 0, icon: ClipboardList, tone: 'blue' },
    { label: 'Open deals', value: openTransactionCount[0]?.value ?? 0, icon: Activity, tone: 'green' },
    { label: 'Active claims', value: activeClaimCount[0]?.value ?? 0, icon: Gavel, tone: 'amber' },
  ];

  return (
    <AdminFrame activeNav="overview">
        <main className="admin-main">
          <div className="admin-heading">
            <div><h1>Admin overview</h1><p>Keep the marketplace healthy, trusted, and moving.</p></div>
          </div>

          <section className="admin-stats" aria-label="Platform summary">
            {stats.map(({ label, value, icon: Icon, tone }) => <article className={`admin-stat admin-stat--${tone}`} key={label}><div className="admin-stat__icon"><Icon size={19} aria-hidden="true" /></div><div><strong>{value}</strong><span>{label}</span></div></article>)}
          </section>

          <div className="admin-content-grid admin-content-grid--single">
            <section className="admin-panel" id="listings">
              <div className="admin-panel__heading"><div><h2>Recent listings</h2></div><span>{recentListings.length} shown</span></div>
              {recentListings.length === 0 ? <p className="admin-empty">No listings have been created yet.</p> : <div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Seller</th><th>Type</th><th>Status</th></tr></thead><tbody>{recentListings.map((listing) => <tr key={listing.id}><td><strong>{listing.title}</strong><small>{listing.createdAt.toLocaleDateString('en-TT')}</small></td><td>{listing.sellerName}</td><td>{displayStatus(listing.saleType)}</td><td><span className={`admin-status admin-status--${listing.status}`}>{displayStatus(listing.status)}</span></td></tr>)}</tbody></table></div>}
            </section>
          </div>
        </main>
    </AdminFrame>
  );
}
