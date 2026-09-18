import { count, desc, gte } from 'drizzle-orm';
import { BarChart3, CalendarDays, ShieldCheck } from 'lucide-react';

import { db } from '@/db/client';
import { analyticsEvents } from '@/db/schema/analytics';
import { adminAccess } from '@/lib/admin';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';

const WINDOW_DAYS = 30;
const EVENT_LABELS: Record<string, string> = {
  listing_created: 'Listings created',
  listing_published: 'Listings published',
  reservation_created: 'Reservations created',
  bid_placed: 'Bids placed',
  transaction_completed: 'Transactions completed',
  transaction_terminated: 'Transactions terminated',
  support_case_created: 'Support cases opened',
};

export default async function AdminAnalyticsPage() {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ eventName: analyticsEvents.eventName, value: count() })
    .from(analyticsEvents)
    .where(gte(analyticsEvents.occurredAt, since))
    .groupBy(analyticsEvents.eventName)
    .orderBy(desc(count()));
  const values = new Map(rows.map((row) => [row.eventName, Number(row.value)]));

  return (
    <AdminFrame activeNav="analytics">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div>
            <p className="admin-kicker">Operations reporting</p>
            <h1>Analytics</h1>
            <p>First-party event counts for the last {WINDOW_DAYS} days. These are aggregate operational signals, not member profiles.</p>
          </div>
          <span className="admin-environment"><CalendarDays size={15} aria-hidden="true" />Last {WINDOW_DAYS} days</span>
        </div>

        <section className="admin-stats" aria-label="Marketplace funnel summary">
          {Object.entries(EVENT_LABELS).slice(0, 5).map(([eventName, label], index) => {
            const tones = ['purple', 'blue', 'amber', 'green', 'purple'];
            return <article className={`admin-stat admin-stat--${tones[index]}`} key={eventName}>
              <div className="admin-stat__icon"><BarChart3 size={19} aria-hidden="true" /></div>
              <div><strong>{(values.get(eventName) ?? 0).toLocaleString()}</strong><span>{label}</span></div>
            </article>;
          })}
        </section>

        <section className="admin-panel admin-directory-panel" aria-labelledby="analytics-events-title">
          <div className="admin-panel__heading">
            <div><h2 id="analytics-events-title">Tracked event definitions</h2><p className="admin-panel__subcopy">Events use stable idempotency keys and exclude message contents, phone numbers, and payment details.</p></div>
            <ShieldCheck size={19} aria-hidden="true" />
          </div>
          <div className="admin-table-wrap">
            <table className="admin-detail-table">
              <caption className="sr-only">Analytics event counts</caption>
              <thead><tr><th scope="col">Event</th><th scope="col">30-day count</th><th scope="col">Purpose</th></tr></thead>
              <tbody>{Object.entries(EVENT_LABELS).map(([eventName, label]) => (
                <tr key={eventName}><th scope="row">{label}<small>{eventName}</small></th><td>{(values.get(eventName) ?? 0).toLocaleString()}</td><td>{eventName === 'support_case_created' ? 'Support workload' : 'Marketplace funnel and outcome reporting'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </main>
    </AdminFrame>
  );
}
