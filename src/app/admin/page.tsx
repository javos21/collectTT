import { Activity, ClipboardList, Gavel, Users } from 'lucide-react';
import { count, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { claims, listings } from '@/db/schema/listings';
import { transactions } from '@/db/schema/transactions';
import { adminAccess } from '@/lib/admin';
import { AdminDenied } from './admin-access';
import { AdminFrame } from './admin-frame';

export default async function AdminPage() {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const [userCount, activeListingCount, openTransactionCount, activeClaimCount] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(listings).where(eq(listings.status, 'active')),
    db.select({ value: count() }).from(transactions).where(eq(transactions.state, 'open')),
    db.select({ value: count() }).from(claims).where(eq(claims.status, 'active')),
  ]);

  const stats = [
    { label: 'Members', value: userCount[0]?.value ?? 0, icon: Users, tone: 'purple' },
    { label: 'Active listings', value: activeListingCount[0]?.value ?? 0, icon: ClipboardList, tone: 'blue' },
    { label: 'Open deals', value: openTransactionCount[0]?.value ?? 0, icon: Activity, tone: 'green' },
    { label: 'Active claims', value: activeClaimCount[0]?.value ?? 0, icon: Gavel, tone: 'amber' },
  ];

  return (
    <AdminFrame activeNav="overview">
        <main className="admin-main" id="admin-main">
          <div className="admin-heading">
            <div><h1>Admin overview</h1></div>
          </div>

          <section className="admin-stats" aria-label="Platform summary">
            {stats.map(({ label, value, icon: Icon, tone }) => <article className={`admin-stat admin-stat--${tone}`} key={label}><div className="admin-stat__icon"><Icon size={19} aria-hidden="true" /></div><div><strong>{value}</strong><span>{label}</span></div></article>)}
          </section>

        </main>
    </AdminFrame>
  );
}
