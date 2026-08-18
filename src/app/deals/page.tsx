import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { transactions } from '@/db/schema/transactions';
import { listings } from '@/db/schema/listings';
import { formatMoney } from '@/domain/money';

export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<string, string> = {
  open: 'In progress',
  completed: 'Completed',
  reneged_buyer: 'Cancelled — no payment',
  reneged_seller: 'Cancelled — not delivered',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export default async function DealsPage() {
  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in');

  const rows = await db
    .select({ t: transactions, title: listings.title })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .where(or(eq(transactions.buyerId, viewer.userId), eq(transactions.sellerId, viewer.userId)))
    .orderBy(desc(transactions.createdAt))
    .limit(50);

  const open = rows.filter((r) => r.t.state === 'open');
  const past = rows.filter((r) => r.t.state !== 'open');

  return (
    <main>
      <h1>My deals</h1>

      <h2>Needs attention</h2>
      {open.length === 0 ? (
        <p className="muted">Nothing in progress.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Role</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {open.map(({ t, title }) => {
              const isBuyer = t.buyerId === viewer.userId;
              const waitingOnMe =
                (isBuyer && t.paymentState === 'pending') ||
                (!isBuyer && t.paymentState === 'buyer_marked_paid');
              return (
                <tr key={t.id}>
                  <td>
                    <Link href={`/deals/${t.id}`}>{title}</Link>
                  </td>
                  <td>{isBuyer ? 'buying' : 'selling'}</td>
                  <td>{formatMoney(t.amountCents)}</td>
                  <td>
                    {waitingOnMe ? (
                      <strong>Your move</strong>
                    ) : (
                      <span className="muted">Waiting on them</span>
                    )}
                  </td>
                  <td className="muted">{t.paymentDeadlineAt.toLocaleString('en-TT')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>History</h2>
      {past.length === 0 ? (
        <p className="muted">No finished deals yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Role</th>
              <th>Amount</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {past.map(({ t, title }) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/deals/${t.id}`}>{title}</Link>
                </td>
                <td>{t.buyerId === viewer.userId ? 'buying' : 'selling'}</td>
                <td>{formatMoney(t.amountCents)}</td>
                <td>{STATE_LABELS[t.state]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
