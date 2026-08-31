import { Activity, ClipboardList, Gavel, ShieldCheck, Users } from 'lucide-react';
import { count, desc, eq } from 'drizzle-orm';

import { db } from '../../../src/db/client';
import { users } from '../../../src/db/schema/auth';
import { claims, listings } from '../../../src/db/schema/listings';
import { profiles } from '../../../src/db/schema/profiles';
import { transactions } from '../../../src/db/schema/transactions';
import { currentUser } from '../../../src/lib/session';
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
    <AdminFrame viewer={viewer} activeNav="overview">
        <main className="admin-main">
          <div className="admin-heading">
            <div><p className="admin-kicker">Operations</p><h1>Admin overview</h1><p>Keep the marketplace healthy, trusted, and moving.</p></div>
            <span className="admin-environment">Local development</span>
          </div>

          <section className="admin-stats" aria-label="Platform summary">
            {stats.map(({ label, value, icon: Icon, tone }) => <article className={`admin-stat admin-stat--${tone}`} key={label}><div className="admin-stat__icon"><Icon size={19} aria-hidden="true" /></div><div><strong>{value}</strong><span>{label}</span></div></article>)}
          </section>

          <div className="admin-content-grid">
            <section className="admin-panel" id="listings">
              <div className="admin-panel__heading"><div><p className="admin-kicker">Marketplace activity</p><h2>Recent listings</h2></div><span>{recentListings.length} shown</span></div>
              {recentListings.length === 0 ? <p className="admin-empty">No listings have been created yet.</p> : <div className="admin-table-wrap"><table><thead><tr><th>Listing</th><th>Seller</th><th>Type</th><th>Status</th></tr></thead><tbody>{recentListings.map((listing) => <tr key={listing.id}><td><strong>{listing.title}</strong><small>{listing.createdAt.toLocaleDateString('en-TT')}</small></td><td>{listing.sellerName}</td><td>{displayStatus(listing.saleType)}</td><td><span className={`admin-status admin-status--${listing.status}`}>{displayStatus(listing.status)}</span></td></tr>)}</tbody></table></div>}
            </section>
            <section className="admin-panel admin-panel--focus">
              <div className="admin-panel__heading"><div><p className="admin-kicker">Next checks</p><h2>Trust &amp; safety</h2></div><ShieldCheck size={19} aria-hidden="true" /></div>
              <div className="admin-checklist"><div><span className="admin-checklist__indicator admin-checklist__indicator--green" /><div><strong>Reputation events</strong><p>Objective activity powers account protections.</p></div></div><div><span className="admin-checklist__indicator admin-checklist__indicator--blue" /><div><strong>Moderation queue</strong><p>Review reports and account restrictions here.</p></div></div><div><span className="admin-checklist__indicator admin-checklist__indicator--amber" /><div><strong>Store operations</strong><p>Monitor store handoffs and open custody work.</p></div></div></div>
              <p className="admin-panel__note">This is the initial admin shell. High-impact actions will be added behind explicit confirmations and audit logging.</p>
            </section>
          </div>
        </main>
    </AdminFrame>
  );
}
