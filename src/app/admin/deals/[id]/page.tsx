import Link from 'next/link';
import { asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { Activity, AlertTriangle, ArrowLeft, CircleDollarSign, Clock3, FileText, History, Mail, PackageCheck, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { custodyHoldings, relayStores } from '@/db/schema/custody';
import { listings, categories } from '@/db/schema/listings';
import { disputes, notificationDeliveries } from '@/db/schema/notifications';
import { profiles } from '@/db/schema/profiles';
import { transactions, transactionEvents } from '@/db/schema/transactions';
import { users } from '@/db/schema/auth';
import { formatMoney } from '@/domain/money';
import { requireAdmin } from '@/lib/admin';
import { AdminFrame } from '../../admin-frame';

function dateTime(value: Date | null): string {
  return value === null ? '—' : value.toLocaleString('en-TT', { dateStyle: 'medium', timeStyle: 'short' });
}

function label(value: string | null): string {
  return value === null ? '—' : value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): string {
  if (status === 'open') return 'active';
  if (status === 'completed' || status === 'confirmed' || status === 'picked_up' || status === 'sent') return 'confirmed';
  if (status === 'failed' || status === 'declined' || status === 'reneged_buyer' || status === 'reneged_seller' || status === 'cancelled' || status === 'expired') return 'declined';
  if (status === 'pending' || status === 'buyer_marked_paid' || status === 'awaiting_dropoff' || status === 'at_relay' || status === 'release_authorized') return 'pending';
  return 'ended';
}

function money(cents: number, currency: string): string {
  return formatMoney(cents, currency === 'USD' ? 'USD' : 'TTD');
}

function isOverdue(value: Date | null, state: string, now: Date): boolean {
  return state === 'open' && value !== null && value < now;
}

export default async function AdminDealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/deals/${encodeURIComponent(id)}`);

  const dealRows = await db
    .select({ transaction: transactions, listing: listings, categoryLabel: categories.label })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .innerJoin(categories, eq(categories.key, listings.category))
    .where(eq(transactions.id, id))
    .limit(1);

  const row = dealRows[0];
  if (row === undefined) notFound();
  const transaction = row.transaction;
  const now = new Date();

  const [participantRows, eventRows, notificationRows, disputeRows, custodyRows] = await Promise.all([
    db
      .select({ userId: profiles.userId, displayName: profiles.displayName, handle: profiles.handle, email: users.email, role: profiles.role, status: profiles.status })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(inArray(profiles.userId, [transaction.buyerId, transaction.sellerId])),
    db
      .select({
        id: transactionEvents.id,
        track: transactionEvents.track,
        fromState: transactionEvents.fromState,
        toState: transactionEvents.toState,
        actorUserId: transactionEvents.actorUserId,
        actorRole: transactionEvents.actorRole,
        reason: transactionEvents.reason,
        metadata: transactionEvents.metadata,
        occurredAt: transactionEvents.occurredAt,
        actorName: profiles.displayName,
        actorHandle: profiles.handle,
      })
      .from(transactionEvents)
      .leftJoin(profiles, eq(profiles.userId, transactionEvents.actorUserId))
      .where(eq(transactionEvents.transactionId, id))
      .orderBy(asc(transactionEvents.occurredAt)),
    db
      .select({
        id: notificationDeliveries.id,
        userId: notificationDeliveries.userId,
        recipientName: profiles.displayName,
        eventType: notificationDeliveries.eventType,
        channel: notificationDeliveries.channel,
        status: notificationDeliveries.status,
        attempts: notificationDeliveries.attempts,
        lastError: notificationDeliveries.lastError,
        createdAt: notificationDeliveries.createdAt,
        sentAt: notificationDeliveries.sentAt,
      })
      .from(notificationDeliveries)
      .innerJoin(profiles, eq(profiles.userId, notificationDeliveries.userId))
      .where(or(
        sql`${notificationDeliveries.payload}->'message'->>'linkUrl' = ${`/deals/${id}`}`,
        sql`${notificationDeliveries.payload}->'data'->>'transactionId' = ${id}`,
      ))
      .orderBy(desc(notificationDeliveries.createdAt)),
    db
      .select({
        id: disputes.id,
        raisedBy: disputes.raisedBy,
        raisedByName: sql<string>`(select p.display_name from profiles p where p.user_id = ${disputes.raisedBy})`,
        reason: disputes.reason,
        status: disputes.status,
        detail: disputes.detail,
        resolution: disputes.resolution,
        resolvedBy: disputes.resolvedBy,
        resolvedByName: sql<string | null>`(select p.display_name from profiles p where p.user_id = ${disputes.resolvedBy})`,
        createdAt: disputes.createdAt,
        resolvedAt: disputes.resolvedAt,
      })
      .from(disputes)
      .where(eq(disputes.transactionId, id))
      .orderBy(desc(disputes.createdAt)),
    transaction.custodyHoldingId === null
      ? Promise.resolve([])
      : db
          .select({
            id: custodyHoldings.id,
            holder: custodyHoldings.holder,
            state: custodyHoldings.state,
            storeName: relayStores.name,
            storeArea: relayStores.area,
            dropoffCode: custodyHoldings.dropoffCode,
            droppedOffAt: custodyHoldings.droppedOffAt,
            pickedUpAt: custodyHoldings.pickedUpAt,
            returnedAt: custodyHoldings.returnedAt,
            custodyExpiresAt: custodyHoldings.custodyExpiresAt,
            overstayFlaggedAt: custodyHoldings.overstayFlaggedAt,
          })
          .from(custodyHoldings)
          .leftJoin(relayStores, eq(relayStores.id, custodyHoldings.storeId))
          .where(eq(custodyHoldings.id, transaction.custodyHoldingId)),
  ]);

  const buyer = participantRows.find((participant) => participant.userId === transaction.buyerId);
  const seller = participantRows.find((participant) => participant.userId === transaction.sellerId);
  const custody = custodyRows[0];
  const paymentOverdue = isOverdue(transaction.paymentDeadlineAt, transaction.state, now);
  const dropoffOverdue = isOverdue(transaction.sellerDropoffDeadlineAt, transaction.state, now);

  return (
    <AdminFrame activeNav="deals">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading admin-heading--detail">
          <div>
            <Link className="admin-back-link" href="/admin/deals"><ArrowLeft size={15} aria-hidden="true" />Deal directory</Link>
            <p className="admin-kicker">Deal detail</p>
            <h1>{row.listing.title}</h1>
            <p>{row.categoryLabel} · Attempt {transaction.attemptNumber} · {label(transaction.source)} · Started {dateTime(transaction.createdAt)}</p>
          </div>
          <span className={`admin-status admin-status--${statusTone(transaction.state)}`}>{label(transaction.state)}</span>
        </div>

        <section className="admin-stats admin-deal-stats" aria-label="Deal summary">
          <article className="admin-stat admin-stat--purple"><div className="admin-stat__icon"><CircleDollarSign size={19} aria-hidden="true" /></div><div><strong>{money(transaction.amountCents, transaction.currency)}</strong><span>Agreed amount</span></div></article>
          <article className="admin-stat admin-stat--blue"><div className="admin-stat__icon"><Activity size={19} aria-hidden="true" /></div><div><strong>{label(transaction.state)}</strong><span>Deal state</span></div></article>
          <article className="admin-stat admin-stat--green"><div className="admin-stat__icon"><CircleDollarSign size={19} aria-hidden="true" /></div><div><strong>{label(transaction.paymentState)}</strong><span>Payment track</span></div></article>
          <article className="admin-stat admin-stat--amber"><div className="admin-stat__icon"><PackageCheck size={19} aria-hidden="true" /></div><div><strong>{label(transaction.custodyState)}</strong><span>Custody track</span></div></article>
        </section>

        <div className="admin-detail-grid">
          <section className="admin-panel" aria-labelledby="deal-listing-title">
            <div className="admin-panel__heading"><div><h2 id="deal-listing-title">Linked listing</h2><p className="admin-panel__subcopy">Inventory context for this transaction attempt.</p></div><FileText size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Listing</dt><dd><Link href={`/admin/listings/${encodeURIComponent(transaction.listingId)}`}>{row.listing.title}</Link><small>{transaction.listingId}</small></dd></div>
              <div><dt>Category</dt><dd>{row.categoryLabel}</dd></div>
              <div><dt>Source</dt><dd>{label(transaction.source)}<small>Attempt {transaction.attemptNumber}</small></dd></div>
              <div><dt>Fulfillment</dt><dd>{label(transaction.fulfillmentPath)}</dd></div>
              <div><dt>Settlement</dt><dd>{label(transaction.settlementMethod)}</dd></div>
              <div><dt>Candidate links</dt><dd><small>Claim: {transaction.claimId ?? '—'}</small><small>Winning bid: {transaction.winningBidId ?? '—'}</small><small>Offer: {transaction.offerId ?? '—'}</small></dd></div>
            </dl>
          </section>

          <section className="admin-panel" aria-labelledby="deal-participants-title">
            <div className="admin-panel__heading"><div><h2 id="deal-participants-title">Participants</h2><p className="admin-panel__subcopy">Both parties and their current account context.</p></div><UserRound size={19} aria-hidden="true" /></div>
            <div className="admin-person-stack">
              {[{ role: 'Buyer', person: buyer }, { role: 'Seller', person: seller }].map(({ role, person }) => <div className="admin-person-card" key={role}><span className="admin-person-card__role">{role}</span><div><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(person?.userId ?? '')}`}>{person?.displayName ?? 'Unavailable member'}</Link><small>@{person?.handle ?? '—'} · {person?.email ?? 'Email unavailable'}</small><small>{person === undefined ? 'Participant record unavailable' : `${label(person.status)} account · ${label(person.role)}`}</small></div></div>)}
            </div>
          </section>
        </div>

        <section className="admin-panel admin-detail-section" aria-labelledby="deal-tracks-title">
          <div className="admin-panel__heading"><div><h2 id="deal-tracks-title">State tracks and deadlines</h2><p className="admin-panel__subcopy">Payment and item custody advance independently; completion requires both tracks to settle.</p></div><Clock3 size={19} aria-hidden="true" /></div>
          <div className="admin-track-grid">
            <article className={`admin-track-card admin-track-card--${statusTone(transaction.paymentState)}`}><div className="admin-track-card__heading"><div><span>Payment track</span><h3>{label(transaction.paymentState)}</h3></div><CircleDollarSign size={20} aria-hidden="true" /></div><dl className="admin-detail-list"><div><dt>Deadline</dt><dd className={paymentOverdue ? 'admin-deadline admin-deadline--overdue' : 'admin-deadline'}>{dateTime(transaction.paymentDeadlineAt)}{paymentOverdue && <small>Overdue</small>}</dd></div><div><dt>Marked paid</dt><dd>{dateTime(transaction.markedPaidAt)}</dd></div><div><dt>Confirmed</dt><dd>{dateTime(transaction.paymentConfirmedAt)}</dd></div><div><dt>Disputed</dt><dd>{dateTime(transaction.paymentDisputedAt)}</dd></div></dl></article>
            <article className={`admin-track-card admin-track-card--${statusTone(transaction.custodyState)}`}><div className="admin-track-card__heading"><div><span>Custody track</span><h3>{label(transaction.custodyState)}</h3></div><PackageCheck size={20} aria-hidden="true" /></div><dl className="admin-detail-list"><div><dt>Seller drop-off due</dt><dd className={dropoffOverdue ? 'admin-deadline admin-deadline--overdue' : 'admin-deadline'}>{dateTime(transaction.sellerDropoffDeadlineAt)}{dropoffOverdue && <small>Overdue</small>}</dd></div><div><dt>Completed</dt><dd>{dateTime(transaction.completedAt)}</dd></div><div><dt>Terminated</dt><dd>{dateTime(transaction.terminatedAt)}<small>{label(transaction.terminatedReason)}</small></dd></div><div><dt>Fulfillment path</dt><dd>{label(transaction.fulfillmentPath)}</dd></div></dl></article>
          </div>
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="deal-custody-title">
          <div className="admin-panel__heading"><div><h2 id="deal-custody-title">Retained custody record</h2><p className="admin-panel__subcopy">Admin-visible operational record only; no store-staff actions are exposed here.</p></div><PackageCheck size={19} aria-hidden="true" /></div>
          {custody === undefined ? <p className="admin-empty-copy">No retained custody record is linked to this deal.</p> : <dl className="admin-detail-list"><div><dt>Holding</dt><dd><code>{custody.id}</code><small>{label(custody.holder)} · {label(custody.state)}</small></dd></div><div><dt>Location</dt><dd>{custody.storeName ?? 'No relay store'}<small>{custody.storeArea ?? '—'}</small></dd></div><div><dt>Drop-off code</dt><dd><code>{custody.dropoffCode}</code></dd></div><div><dt>Drop-off</dt><dd>{dateTime(custody.droppedOffAt)}</dd></div><div><dt>Pickup / return</dt><dd>{dateTime(custody.pickedUpAt)}<small>Returned {dateTime(custody.returnedAt)}</small></dd></div><div><dt>Custody clock</dt><dd>{dateTime(custody.custodyExpiresAt)}<small>{custody.overstayFlaggedAt === null ? 'No overstay flag' : `Overstay flagged ${dateTime(custody.overstayFlaggedAt)}`}</small></dd></div></dl>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="deal-disputes-title">
          <div className="admin-panel__heading"><div><h2 id="deal-disputes-title">Disputes and support context</h2><p className="admin-panel__subcopy">Recorded dispute history is visible; guided support actions come later.</p></div><AlertTriangle size={19} aria-hidden="true" /></div>
          {disputeRows.length === 0 ? <p className="admin-empty-copy">No disputes recorded for this deal.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Deal disputes</caption><thead><tr><th scope="col">Reason</th><th scope="col">Raised by</th><th scope="col">Status</th><th scope="col">Detail</th><th scope="col">Resolution</th><th scope="col">Created</th></tr></thead><tbody>{disputeRows.map((dispute) => <tr key={dispute.id}><th scope="row">{label(dispute.reason)}<small>{dispute.id}</small></th><td>{dispute.raisedByName}<small>{dispute.raisedBy}</small></td><td><span className={`admin-status admin-status--${statusTone(dispute.status)}`}>{label(dispute.status)}</span></td><td>{dispute.detail}</td><td>{dispute.resolution ?? '—'}<small>{dispute.resolvedByName === null ? '' : `Resolved by ${dispute.resolvedByName}`}</small></td><td>{dateTime(dispute.createdAt)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="deal-events-title">
          <div className="admin-panel__heading"><div><h2 id="deal-events-title">Transaction timeline</h2><p className="admin-panel__subcopy">Append-only state transitions with actor and reason.</p></div><History size={19} aria-hidden="true" /></div>
          {eventRows.length === 0 ? <p className="admin-empty-copy">No transaction events recorded.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Transaction timeline</caption><thead><tr><th scope="col">Track</th><th scope="col">Transition</th><th scope="col">Actor</th><th scope="col">Reason</th><th scope="col">Occurred</th><th scope="col">Metadata</th></tr></thead><tbody>{eventRows.map((event) => <tr key={event.id}><th scope="row">{label(event.track)}</th><td><strong>{label(event.fromState)}</strong><small>to {label(event.toState)}</small></td><td>{event.actorName ?? label(event.actorRole)}<small>{event.actorUserId ?? 'System actor'}</small></td><td>{event.reason ?? '—'}</td><td>{dateTime(event.occurredAt)}</td><td><pre className="admin-audit-meta">{JSON.stringify(event.metadata)}</pre></td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="deal-notifications-title">
          <div className="admin-panel__heading"><div><h2 id="deal-notifications-title">Notification history</h2><p className="admin-panel__subcopy">In-app, email, and any legacy channel delivery records linked to this deal.</p></div><Mail size={19} aria-hidden="true" /></div>
          {notificationRows.length === 0 ? <p className="admin-empty-copy">No notification deliveries linked to this deal were found.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Deal notification history</caption><thead><tr><th scope="col">Recipient</th><th scope="col">Event</th><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">Created</th><th scope="col">Sent</th><th scope="col">Error</th></tr></thead><tbody>{notificationRows.map((notification) => <tr key={notification.id}><th scope="row">{notification.recipientName}<small>{notification.userId}</small></th><td>{label(notification.eventType)}</td><td>{label(notification.channel)}</td><td><span className={`admin-status admin-status--${statusTone(notification.status)}`}>{label(notification.status)}</span></td><td>{notification.attempts}</td><td>{dateTime(notification.createdAt)}</td><td>{dateTime(notification.sentAt)}</td><td className={notification.lastError === null ? '' : 'admin-notification-error'}>{notification.lastError ?? '—'}</td></tr>)}</tbody></table></div>}
        </section>
      </main>
    </AdminFrame>
  );
}
