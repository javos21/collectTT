import Link from 'next/link';
import { and, asc, desc, eq } from 'drizzle-orm';
import { ArrowLeft, Bell, CheckCircle2, Clock3, FileText, Mail, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { notificationDeliveries, notificationPreferences, notifications } from '@/db/schema/notifications';
import { profiles } from '@/db/schema/profiles';
import { requireAdmin } from '@/lib/admin';
import { AdminFrame } from '../../admin-frame';
import { RetryDeliveryForm } from '../retry-delivery-form';

const CHANNELS = ['in_app', 'email', 'whatsapp', 'sms'] as const;

function dateTime(value: Date | null): string {
  return value === null ? '—' : value.toLocaleString('en-TT', { dateStyle: 'medium', timeStyle: 'short' });
}

function label(value: string | null): string {
  return value === null ? '—' : value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): string {
  if (status === 'sent') return 'confirmed';
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'declined';
  return 'ended';
}

function payloadObject(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
}

function payloadMessage(payload: unknown): { title: string; body: string; linkUrl: string | null } {
  const message = payloadObject(payload).message;
  const data = payloadObject(message);
  return {
    title: typeof data.title === 'string' ? data.title : 'Notification message unavailable',
    body: typeof data.body === 'string' ? data.body : 'No rendered message body was stored.',
    linkUrl: typeof data.linkUrl === 'string' ? data.linkUrl : null,
  };
}

function payloadData(payload: unknown): Record<string, unknown> {
  return payloadObject(payload).data as Record<string, unknown> ?? {};
}

function targetHref(linkUrl: string | null): string | null {
  if (linkUrl?.startsWith('/deals/')) return `/admin/deals/${encodeURIComponent(linkUrl.slice('/deals/'.length))}`;
  if (linkUrl?.startsWith('/listings/')) return `/admin/listings/${encodeURIComponent(linkUrl.slice('/listings/'.length))}`;
  return null;
}

export default async function AdminNotificationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ retry?: string; retryError?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  await requireAdmin(`/admin/notifications/${encodeURIComponent(id)}`);

  const deliveryRows = await db
    .select({
      id: notificationDeliveries.id,
      eventId: notificationDeliveries.eventId,
      userId: notificationDeliveries.userId,
      displayName: profiles.displayName,
      handle: profiles.handle,
      email: users.email,
      eventType: notificationDeliveries.eventType,
      channel: notificationDeliveries.channel,
      status: notificationDeliveries.status,
      payload: notificationDeliveries.payload,
      dedupeKey: notificationDeliveries.dedupeKey,
      providerMessageId: notificationDeliveries.providerMessageId,
      attempts: notificationDeliveries.attempts,
      lastError: notificationDeliveries.lastError,
      createdAt: notificationDeliveries.createdAt,
      sentAt: notificationDeliveries.sentAt,
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
    .where(eq(notificationDeliveries.id, id))
    .limit(1);

  const delivery = deliveryRows[0];
  if (delivery === undefined) notFound();
  const message = payloadMessage(delivery.payload);
  const data = payloadData(delivery.payload);
  const target = targetHref(message.linkUrl);

  const [siblingRows, inAppRows, preferenceRows] = await Promise.all([
    db
      .select({
        id: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        attempts: notificationDeliveries.attempts,
        lastError: notificationDeliveries.lastError,
        createdAt: notificationDeliveries.createdAt,
        sentAt: notificationDeliveries.sentAt,
      })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.eventId, delivery.eventId))
      .orderBy(asc(notificationDeliveries.channel)),
    db
      .select({ id: notifications.id, title: notifications.title, body: notifications.body, linkUrl: notifications.linkUrl, readAt: notifications.readAt, createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(
        eq(notifications.userId, delivery.userId),
        eq(notifications.eventType, delivery.eventType),
      ))
      .orderBy(desc(notifications.createdAt))
      .limit(10),
    db
      .select({ channel: notificationPreferences.channel, enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.userId, delivery.userId),
        eq(notificationPreferences.eventType, delivery.eventType),
      )),
  ]);
  const preferenceMap = new Map(preferenceRows.map((preference) => [preference.channel, preference.enabled]));

  return (
    <AdminFrame activeNav="notifications">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading admin-heading--detail">
          <div>
            <Link className="admin-back-link" href="/admin/notifications"><ArrowLeft size={15} aria-hidden="true" />Delivery history</Link>
            <p className="admin-kicker">Notification delivery</p>
            <h1>{label(delivery.eventType)}</h1>
            <p>{delivery.channel} · Created {dateTime(delivery.createdAt)}</p>
          </div>
          <span className={`admin-status admin-status--${statusTone(delivery.status)}`}>{label(delivery.status)}</span>
        </div>

        <section className="admin-stats admin-notification-stats" aria-label="Notification delivery summary">
          <article className="admin-stat admin-stat--purple"><div className="admin-stat__icon"><Mail size={19} aria-hidden="true" /></div><div><strong>{label(delivery.channel)}</strong><span>Channel</span></div></article>
          <article className="admin-stat admin-stat--amber"><div className="admin-stat__icon"><Clock3 size={19} aria-hidden="true" /></div><div><strong>{delivery.attempts}</strong><span>Attempts</span></div></article>
          <article className="admin-stat admin-stat--green"><div className="admin-stat__icon"><CheckCircle2 size={19} aria-hidden="true" /></div><div><strong>{siblingRows.length}</strong><span>Event channels</span></div></article>
          <article className="admin-stat admin-stat--blue"><div className="admin-stat__icon"><Bell size={19} aria-hidden="true" /></div><div><strong>{delivery.emailEnabled === false ? 'Off' : delivery.emailEnabled === true ? 'On' : 'Default'}</strong><span>Email preference</span></div></article>
        </section>

        <div className="admin-detail-grid">
          <section className="admin-panel" aria-labelledby="notification-recipient-title">
            <div className="admin-panel__heading"><div><h2 id="notification-recipient-title">Recipient</h2><p className="admin-panel__subcopy">Member context for this delivery.</p></div><UserRound size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Member</dt><dd><Link href={`/admin/members/${encodeURIComponent(delivery.userId)}`}><UserRound size={14} aria-hidden="true" />{delivery.displayName}</Link><small>@{delivery.handle}</small></dd></div>
              <div><dt>Email</dt><dd><a href={`mailto:${delivery.email}`}>{delivery.email}</a></dd></div>
              <div><dt>User ID</dt><dd><code>{delivery.userId}</code></dd></div>
              <div><dt>Email preference</dt><dd><span className={`admin-status admin-status--${delivery.emailEnabled === false ? 'declined' : delivery.emailEnabled === true ? 'confirmed' : 'ended'}`}>{delivery.emailEnabled === false ? 'Disabled' : delivery.emailEnabled === true ? 'Enabled' : 'Default / not set'}</span></dd></div>
            </dl>
          </section>

          <section className="admin-panel" aria-labelledby="notification-target-title">
            <div className="admin-panel__heading"><div><h2 id="notification-target-title">Linked context</h2><p className="admin-panel__subcopy">Destination and event identifiers used for support lookup.</p></div><FileText size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Target</dt><dd>{target === null ? message.linkUrl ?? 'No destination' : <Link href={target}>{message.linkUrl?.startsWith('/deals/') ? 'Go to deal' : 'View listing'}</Link>}<small>{message.linkUrl ?? 'No link stored'}</small></dd></div>
              <div><dt>Event ID</dt><dd><code>{delivery.eventId}</code></dd></div>
              <div><dt>Delivery ID</dt><dd><code>{delivery.id}</code></dd></div>
              <div><dt>Deduplication key</dt><dd><code>{delivery.dedupeKey}</code></dd></div>
            </dl>
          </section>
        </div>

        <section className="admin-panel admin-detail-section" aria-labelledby="notification-message-title">
          <div className="admin-panel__heading"><div><h2 id="notification-message-title">Rendered message</h2><p className="admin-panel__subcopy">The provider-facing content is visible without provider credentials or secrets.</p></div><Mail size={19} aria-hidden="true" /></div>
          <article className="admin-notification-message"><h3>{message.title}</h3><p>{message.body}</p>{target !== null && <Link className="admin-button admin-button--secondary" href={target}>{message.linkUrl?.startsWith('/deals/') ? 'Go to deal' : 'View listing'}</Link>}</article>
          <pre className="admin-json-block"><code>{JSON.stringify(data, null, 2)}</code></pre>
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="notification-attempt-title">
          <div className="admin-panel__heading"><div><h2 id="notification-attempt-title">Delivery state</h2><p className="admin-panel__subcopy">Failed email deliveries can be retried with a recorded reason.</p></div><Clock3 size={19} aria-hidden="true" /></div>
          {feedback.retry === 'queued' && <p className="admin-form-success" role="status">Email retry queued successfully. The delivery will update when the worker processes it.</p>}
          {feedback.retryError !== undefined && <p className="admin-form-error" role="alert">{feedback.retryError}</p>}
          <dl className="admin-detail-list">
            <div><dt>Status</dt><dd><span className={`admin-status admin-status--${statusTone(delivery.status)}`}>{label(delivery.status)}</span></dd></div>
            <div><dt>Created</dt><dd>{dateTime(delivery.createdAt)}</dd></div>
            <div><dt>Last sent</dt><dd>{dateTime(delivery.sentAt)}</dd></div>
            <div><dt>Attempts</dt><dd>{delivery.attempts}</dd></div>
            <div><dt>Provider message ID</dt><dd><code>{delivery.providerMessageId ?? 'Not assigned'}</code></dd></div>
            <div><dt>Last error</dt><dd className={delivery.lastError === null ? '' : 'admin-notification-error'}>{delivery.lastError ?? 'No delivery error recorded.'}</dd></div>
          </dl>
          {delivery.channel === 'email' && delivery.status === 'failed' ? (
            <RetryDeliveryForm deliveryId={delivery.id} />
          ) : delivery.status === 'failed' ? (
            <p className="admin-retry-note">Only failed email deliveries can be retried from the admin area.</p>
          ) : (
            <p className="admin-retry-note">Retry becomes available if this delivery enters a failed state.</p>
          )}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="notification-channels-title">
          <div className="admin-panel__heading"><div><h2 id="notification-channels-title">Event channel fan-out</h2><p className="admin-panel__subcopy">Every channel row for this logical event, including in-app fallback state.</p></div><Bell size={19} aria-hidden="true" /></div>
          <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Notification event channels</caption><thead><tr><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Created</th><th scope="col">Sent</th><th scope="col">Error</th></tr></thead><tbody>{siblingRows.map((sibling) => <tr key={sibling.id}><th scope="row">{label(sibling.channel)}<small>{sibling.id}</small></th><td><span className={`admin-status admin-status--${statusTone(sibling.status)}`}>{label(sibling.status)}</span></td><td>{sibling.attempts}</td><td>{dateTime(sibling.createdAt)}</td><td>{dateTime(sibling.sentAt)}</td><td className={sibling.lastError === null ? '' : 'admin-notification-error'}>{sibling.lastError ?? '—'}</td></tr>)}</tbody></table></div>
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="notification-inbox-title">
          <div className="admin-panel__heading"><div><h2 id="notification-inbox-title">In-app record</h2><p className="admin-panel__subcopy">The member-facing inbox row, when the event includes in-app delivery.</p></div><Bell size={19} aria-hidden="true" /></div>
          {inAppRows.length === 0 ? <p className="admin-empty-copy">No matching in-app record was found for this event.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">In-app notification records</caption><thead><tr><th scope="col">Title</th><th scope="col">Body</th><th scope="col">Read state</th><th scope="col">Created</th></tr></thead><tbody>{inAppRows.map((inApp) => <tr key={inApp.id}><th scope="row">{inApp.title}<small>{inApp.id}</small></th><td>{inApp.body}</td><td><span className={`admin-status admin-status--${inApp.readAt === null ? 'pending' : 'confirmed'}`}>{inApp.readAt === null ? 'Unread' : `Read ${dateTime(inApp.readAt)}`}</span></td><td>{dateTime(inApp.createdAt)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="notification-preferences-title">
          <div className="admin-panel__heading"><div><h2 id="notification-preferences-title">Preference state</h2><p className="admin-panel__subcopy">Explicit member settings are shown separately from the default event routing.</p></div><CheckCircle2 size={19} aria-hidden="true" /></div>
          <div className="admin-preference-grid">{CHANNELS.map((channel) => { const enabled = preferenceMap.get(channel); return <div className="admin-preference-row" key={channel}><strong>{label(channel)}</strong><span className={`admin-status admin-status--${enabled === false ? 'declined' : enabled === true ? 'confirmed' : 'ended'}`}>{enabled === false ? 'Disabled' : enabled === true ? 'Enabled' : 'Default / not set'}</span></div>; })}</div>
        </section>
      </main>
    </AdminFrame>
  );
}
