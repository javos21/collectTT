import Link from 'next/link';
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Bell, CheckCircle2, Clock3, Mail, Search, TriangleAlert } from 'lucide-react';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { notificationDeliveries, notificationPreferences } from '@/db/schema/notifications';
import { profiles } from '@/db/schema/profiles';
import { adminAccess } from '@/lib/admin';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';

const PAGE_SIZE = 25;
const DELIVERY_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
const DELIVERY_CHANNELS = ['email', 'in_app', 'whatsapp', 'sms'] as const;
type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

function pageNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function dateTime(value: Date): string {
  return value.toLocaleString('en-TT', { dateStyle: 'medium', timeStyle: 'short' });
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): string {
  if (status === 'sent') return 'confirmed';
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'declined';
  return 'ended';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function targetHref(linkUrl: string | null): string | null {
  if (linkUrl?.startsWith('/deals/')) return `/admin/deals/${encodeURIComponent(linkUrl.slice('/deals/'.length))}`;
  if (linkUrl?.startsWith('/listings/')) return `/admin/listings/${encodeURIComponent(linkUrl.slice('/listings/'.length))}`;
  return null;
}

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; status?: string; channel?: string }> }) {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 80);
  const requestedPage = pageNumber(params.page);
  const selectedStatus = DELIVERY_STATUSES.includes(params.status as DeliveryStatus) ? params.status as DeliveryStatus : 'all';
  const selectedChannel = DELIVERY_CHANNELS.includes(params.channel as DeliveryChannel) ? params.channel as DeliveryChannel : 'email';
  const search = `%${query}%`;
  const searchParts = [
    ilike(users.email, search),
    ilike(users.name, search),
    ilike(profiles.displayName, search),
    ilike(profiles.handle, search),
    ilike(notificationDeliveries.eventType, search),
    sql`${notificationDeliveries.payload}->'message'->>'linkUrl' ilike ${search}`,
    ...(isUuid(query) ? [eq(notificationDeliveries.id, query), eq(notificationDeliveries.eventId, query), eq(profiles.userId, query)] : []),
  ];
  const filter = and(
    eq(notificationDeliveries.channel, selectedChannel),
    selectedStatus === 'all' ? undefined : eq(notificationDeliveries.status, selectedStatus),
    query === '' ? undefined : or(...searchParts),
  );

  const [summaryRows, totalRows] = await Promise.all([
    db
      .select({ status: notificationDeliveries.status, value: count() })
      .from(notificationDeliveries)
      .innerJoin(profiles, eq(profiles.userId, notificationDeliveries.userId))
      .innerJoin(users, eq(users.id, notificationDeliveries.userId))
      .where(filter)
      .groupBy(notificationDeliveries.status),
    db
      .select({ value: count() })
      .from(notificationDeliveries)
      .innerJoin(profiles, eq(profiles.userId, notificationDeliveries.userId))
      .innerJoin(users, eq(users.id, notificationDeliveries.userId))
      .where(filter),
  ]);
  const summary = new Map(summaryRows.map((row) => [row.status, Number(row.value)]));
  const total = Number(totalRows[0]?.value ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const deliveryRows = await db
    .select({
      id: notificationDeliveries.id,
      eventId: notificationDeliveries.eventId,
      userId: profiles.userId,
      displayName: profiles.displayName,
      handle: profiles.handle,
      email: users.email,
      eventType: notificationDeliveries.eventType,
      channel: notificationDeliveries.channel,
      status: notificationDeliveries.status,
      attempts: notificationDeliveries.attempts,
      lastError: notificationDeliveries.lastError,
      createdAt: notificationDeliveries.createdAt,
      sentAt: notificationDeliveries.sentAt,
      linkUrl: sql<string | null>`nullif(${notificationDeliveries.payload}->'message'->>'linkUrl', '')`,
      emailEnabled: notificationPreferences.enabled,
    })
    .from(notificationDeliveries)
    .innerJoin(profiles, eq(profiles.userId, notificationDeliveries.userId))
    .innerJoin(users, eq(users.id, notificationDeliveries.userId))
    .leftJoin(notificationPreferences, and(
      eq(notificationPreferences.userId, notificationDeliveries.userId),
      eq(notificationPreferences.eventType, notificationDeliveries.eventType),
      eq(notificationPreferences.channel, 'email'),
    ))
    .where(filter)
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query !== '') next.set('q', query);
    if (selectedStatus !== 'all') next.set('status', selectedStatus);
    if (selectedChannel !== 'email') next.set('channel', selectedChannel);
    if (nextPage > 1) next.set('page', String(nextPage));
    const encoded = next.toString();
    return encoded === '' ? '/admin/notifications' : `/admin/notifications?${encoded}`;
  };

  return (
    <AdminFrame activeNav="notifications">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div>
            <p className="admin-kicker">Admin workspace</p>
            <h1>Notifications</h1>
            <p>Inspect email delivery health and member preference state without exposing provider credentials.</p>
          </div>
          <span className="admin-environment">Read-only</span>
        </div>

        <section className="admin-stats admin-notification-stats" aria-label="Notification delivery summary">
          <article className="admin-stat admin-stat--amber"><div className="admin-stat__icon"><Clock3 size={19} aria-hidden="true" /></div><div><strong>{summary.get('pending') ?? 0}</strong><span>Pending {label(selectedChannel)} deliveries</span></div></article>
          <article className="admin-stat admin-stat--blue"><div className="admin-stat__icon"><TriangleAlert size={19} aria-hidden="true" /></div><div><strong>{summary.get('failed') ?? 0}</strong><span>Failed deliveries</span></div></article>
          <article className="admin-stat admin-stat--green"><div className="admin-stat__icon"><CheckCircle2 size={19} aria-hidden="true" /></div><div><strong>{summary.get('sent') ?? 0}</strong><span>Sent deliveries</span></div></article>
          <article className="admin-stat admin-stat--purple"><div className="admin-stat__icon"><Mail size={19} aria-hidden="true" /></div><div><strong>{total.toLocaleString()}</strong><span>Matching {label(selectedChannel)} rows</span></div></article>
        </section>

        <section className="admin-panel admin-directory-panel" aria-labelledby="notification-directory-title">
          <div className="admin-panel__heading">
            <div>
              <h2 id="notification-directory-title">Delivery history</h2>
              <p className="admin-panel__subcopy">Email is the active beta channel. Other channel rows remain visible only when explicitly selected.</p>
            </div>
            <Bell size={19} aria-hidden="true" />
          </div>

          <form className="admin-directory-search admin-notification-search" method="get" role="search">
            <label htmlFor="notification-search">Search deliveries</label>
            <div>
              <Search size={16} aria-hidden="true" />
              <input id="notification-search" name="q" type="search" defaultValue={query} placeholder="Member, event, delivery ID, or deal/listing link" autoComplete="off" />
              <label className="sr-only" htmlFor="notification-channel">Filter by channel</label>
              <select id="notification-channel" name="channel" defaultValue={selectedChannel}>
                {DELIVERY_CHANNELS.map((channel) => <option key={channel} value={channel}>{label(channel)}</option>)}
              </select>
              <label className="sr-only" htmlFor="notification-status">Filter by status</label>
              <select id="notification-status" name="status" defaultValue={selectedStatus}>
                <option value="all">All statuses</option>
                {DELIVERY_STATUSES.map((status) => <option key={status} value={status}>{label(status)}</option>)}
              </select>
              <button className="admin-button" type="submit">Search</button>
            </div>
          </form>

          {deliveryRows.length === 0 ? (
            <div className="admin-directory-empty" role="status">
              <Bell size={22} aria-hidden="true" />
              <strong>{query === '' && selectedStatus === 'all' ? 'No matching deliveries' : 'No deliveries found'}</strong>
              <p>{query === '' && selectedStatus === 'all' ? 'Delivery records will appear here as notification events are dispatched.' : 'Try another member, event, status, or channel filter.'}</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-directory-table admin-notification-table">
                <caption className="sr-only">Notification delivery history</caption>
                <thead>
                  <tr><th scope="col">Recipient</th><th scope="col">Event</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Email preference</th><th scope="col">Target</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {deliveryRows.map((delivery) => {
                    const target = targetHref(delivery.linkUrl);
                    return <tr key={delivery.id}>
                      <th scope="row"><Link className="admin-row-link" href={`/admin/notifications/${encodeURIComponent(delivery.id)}`}>{delivery.displayName}</Link><small>{delivery.email} · @{delivery.handle}</small></th>
                      <td>{label(delivery.eventType)}<small>{delivery.id}</small></td>
                      <td><span className={`admin-status admin-status--${statusTone(delivery.status)}`}>{label(delivery.status)}</span>{delivery.lastError !== null && <small className="admin-notification-error">{delivery.lastError}</small>}</td>
                      <td>{delivery.attempts}<small>{delivery.sentAt === null ? 'Not sent' : `Sent ${dateTime(delivery.sentAt)}`}</small></td>
                      <td><span className={`admin-status admin-status--${delivery.emailEnabled === false ? 'declined' : delivery.emailEnabled === true ? 'confirmed' : 'ended'}`}>{delivery.emailEnabled === false ? 'Disabled' : delivery.emailEnabled === true ? 'Enabled' : 'Default / not set'}</span></td>
                      <td>{target === null ? delivery.linkUrl ?? 'No link' : <Link className="admin-row-link" href={target}>{delivery.linkUrl?.startsWith('/deals/') ? 'Go to deal' : 'View listing'}</Link>}</td>
                      <td>{dateTime(delivery.createdAt)}</td>
                      <td><Link className="admin-row-link" href={`/admin/notifications/${encodeURIComponent(delivery.id)}`}>View delivery</Link></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}

          <nav className="admin-pagination" aria-label="Notification delivery pages">
            <span>Page {page} of {pageCount}</span>
            <div>
              {page <= 1 ? <span className="admin-button admin-button--secondary is-disabled" aria-disabled="true">Previous</span> : <Link className="admin-button admin-button--secondary" href={buildHref(page - 1)}>Previous</Link>}
              {page >= pageCount ? <span className="admin-button admin-button--secondary is-disabled" aria-disabled="true">Next</span> : <Link className="admin-button admin-button--secondary" href={buildHref(page + 1)}>Next</Link>}
            </div>
          </nav>
        </section>
      </main>
    </AdminFrame>
  );
}
