import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq, asc, desc } from 'drizzle-orm';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileClock,
  AlertTriangle,
  Phone,
  Settings2,
  Store,
  UserRound,
} from 'lucide-react';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { transactions, transactionEvents } from '@/db/schema/transactions';
import { listings } from '@/db/schema/listings';
import { marketplaceOptions } from '@/db/schema/settings';
import { sellerMeetupLocations } from '@/db/schema/seller-settings';
import { disputes as disputeRecords } from '@/db/schema/notifications';
import { custodyPanelFor } from '@/services/custody';
import { trustSnapshotsForMembers } from '@/services/reputation';
import { counterpartyContact, PrivateDisclosureNotFoundError } from '@/services/private-disclosure';
import { formatMoney } from '@/domain/money';
import { usesCustodyTrack } from '@/domain/states/transaction';
import {
  markPaidAction,
  completeCashMeetupAction,
  confirmCollectionAction,
  submitDisputeAction,
  confirmItemReceivedAction,
} from './actions';
import { serializeTrustSnapshot } from '../buyer-snapshot-data';
import { BuyerSnapshotLink } from '../buyer-snapshot-link';
import { EvidenceUpload } from './evidence-upload';
import { evidenceForViewer } from '@/services/transaction-evidence';
import {
  DISPUTE_REASONS,
  DISPUTE_REASON_LABELS,
} from '@/services/disputes';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Meet in person',
  remote_ship: 'Seller ships to you',
  relay: 'Pick up at a store',
  full_service: 'CollectTT delivery',
};

const SETTLEMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  linx: 'LINX',
  other: 'Other',
};

const STATE_LABELS: Record<string, string> = {
  open: 'In progress',
  completed: 'Completed',
  reneged_buyer: 'Cancelled — buyer did not pay in time',
  reneged_seller: 'Cancelled — seller did not deliver',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function formatDateTime(value: Date) {
  return value.toLocaleString('en-TT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatHistoryDate(value: Date) {
  return {
    date: value.toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: value.toLocaleTimeString('en-TT', { hour: 'numeric', minute: '2-digit' }),
  };
}

function humanize(value: string | null) {
  if (value === null || value.length === 0) return 'Started';
  return value.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function historyReason(value: string | null) {
  if (value === 'claim') return 'Reservation opened';
  if (value === 'offer_accept') return 'Offer accepted';
  if (value === 'auction_win') return 'Auction won';
  if (value === 'auction_runner_up') return 'Auction promotion';
  if (value === 'non_payment') return 'Buyer payment deadline expired';
  if (value === 'buyer_no_show') return 'Buyer did not complete the meetup';
  if (value === 'seller_no_dropoff') return 'Seller drop-off deadline expired';
  if (value === 'seller_no_show') return 'Seller did not complete the meetup';
  if (value === 'transaction terminated before drop-off') return 'Holding cancelled before drop-off';
  return humanize(value);
}

function historyMetadata(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function historyDescription(
  event: typeof transactionEvents.$inferSelect,
  deal: typeof transactions.$inferSelect,
): string | null {
  const metadata = historyMetadata(event.metadata);

  if (event.track === 'overall' && event.toState === 'open') {
    if (event.reason === 'claim') {
      return `The buyer reserved the listing. Payment was due by ${formatDateTime(deal.paymentDeadlineAt)}${usesCustodyTrack(deal.fulfillmentPath) ? '; seller drop-off was not required until payment was confirmed' : ''}.`;
    }
    if (event.reason === 'offer_accept') {
      return `The seller accepted the offer. Payment was due by ${formatDateTime(deal.paymentDeadlineAt)}.`;
    }
    return 'The deal opened and the buyer payment window started.';
  }

  if (event.track === 'payment' && event.toState === 'failed') {
    return `Payment was not confirmed by ${formatDateTime(deal.paymentDeadlineAt)}. The buyer non-payment was recorded; seller drop-off was not required.`;
  }

  if (event.track === 'overall' && event.toState === 'reneged_buyer') {
    return `The buyer did not pay by ${formatDateTime(deal.paymentDeadlineAt)}. The buyer was penalized, and the seller was not penalized because payment was never confirmed.`;
  }

  if (event.track === 'overall' && event.toState === 'reneged_seller') {
    return metadata.sellerDropoffRequired === true || deal.paymentState === 'confirmed'
      ? 'Payment was confirmed, but the seller did not drop off the item by the seller deadline.'
      : 'Payment was not confirmed, so seller drop-off was not yet required.';
  }

  if (event.track === 'custody' && event.toState === 'voided') {
    return deal.paymentState === 'confirmed'
      ? 'The custody holding was cancelled because the transaction ended before drop-off.'
      : 'The item was never dropped off. The holding was cancelled after the buyer failed to pay, with no seller penalty.';
  }

  return null;
}

function Stepper({ steps, current, off }: { steps: string[]; current: number; off: boolean }) {
  return (
    <div className="steps" role="list">
      {steps.map((label, i) => {
        const cls =
          off && i === current
            ? 'step step--off'
            : i < current
              ? 'step step--done'
              : i === current
                ? 'step step--current'
                : 'step';
        return (
          <div className={cls} key={label} role="listitem" aria-current={!off && i === current ? 'step' : undefined}>
            <span className="step__dot" aria-hidden="true" />
            {label}
          </div>
        );
      })}
    </div>
  );
}

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { id } = await params;
  const flash = await searchParams;

  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in');

  const rows = await db
    .select({ t: transactions, listing: listings })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .where(eq(transactions.id, id))
    .limit(1);

  const row = rows[0];
  if (row === undefined) notFound();

  const { t, listing } = row;
  const isBuyer = viewer.userId === t.buyerId;
  const isSeller = viewer.userId === t.sellerId;
  // A deal is private to its two parties — this is not a public record.
  if (!isBuyer && !isSeller) notFound();

  const [deliveryOption, paymentOption, meetupLocation] = await Promise.all([
    t.deliveryOptionId === null
      ? Promise.resolve(null)
      : db.select({ label: marketplaceOptions.label }).from(marketplaceOptions).where(eq(marketplaceOptions.id, t.deliveryOptionId)).limit(1).then((rows) => rows[0] ?? null),
    t.settlementMethod === null
      ? Promise.resolve(null)
      : db.select({ label: marketplaceOptions.label }).from(marketplaceOptions).where(and(
          eq(marketplaceOptions.kind, 'payment'),
          eq(marketplaceOptions.key, t.settlementMethod),
        )).limit(1).then((rows) => rows[0] ?? null),
    t.meetupLocationId === null
      ? Promise.resolve(null)
      : db.select({ label: sellerMeetupLocations.label, area: sellerMeetupLocations.area, instructions: sellerMeetupLocations.instructions })
        .from(sellerMeetupLocations)
        .where(eq(sellerMeetupLocations.id, t.meetupLocationId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
  ]);

  const counterpartyId = isBuyer ? t.sellerId : t.buyerId;
  const counterpartySnapshot = (await trustSnapshotsForMembers(db, [counterpartyId])).get(counterpartyId) ?? null;
  const contact = await counterpartyContact(db, viewer.userId, id).catch((error: unknown) => {
    if (error instanceof PrivateDisclosureNotFoundError) return null;
    throw error;
  });
  const counterpartyName = counterpartySnapshot?.displayName ?? 'the other member';
  const counterpartyRole: 'Seller' | 'Buyer' = isBuyer ? 'Seller' : 'Buyer';

  const [timeline, disputeRows, evidenceRows] = await Promise.all([
    db
      .select()
      .from(transactionEvents)
      .where(eq(transactionEvents.transactionId, id))
      .orderBy(asc(transactionEvents.occurredAt)),
    db
      .select()
      .from(disputeRecords)
      .where(eq(disputeRecords.transactionId, id))
      .orderBy(desc(disputeRecords.createdAt)),
    evidenceForViewer(db, id, viewer.userId),
  ]);

  const isOpen = t.state === 'open';
  const isDisputed = t.disputeState === 'open';
  const hasCustody = usesCustodyTrack(t.fulfillmentPath);
  const custodyPanel = hasCustody ? await custodyPanelFor(db, id) : null;

  const progress = (() => {
    if (hasCustody) {
      const steps = ['Awaiting payment', 'Awaiting drop-off', 'Dropped off', 'Collected'];
      let current = 0;
      if (t.paymentState === 'confirmed') {
        if (t.custodyState === 'picked_up') current = 3;
        else if (t.custodyState === 'at_relay' || t.custodyState === 'release_authorized') current = 2;
        else if (t.custodyState === 'awaiting_dropoff') current = 1;
      }
      return { steps, current, off: t.custodyState === 'returned_to_seller' || t.custodyState === 'voided' };
    }
    if (t.fulfillmentPath === 'cash_meetup') {
      return {
        steps: ['Awaiting payment', 'Paid & collected'],
        current: t.paymentState === 'confirmed' || t.handoffState === 'buyer_received' ? 1 : 0,
        off: t.paymentState === 'failed',
      };
    }
    return {
      steps: ['Awaiting payment', 'Payment recorded'],
      current: t.paymentState === 'confirmed' ? 1 : 0,
      off: t.paymentState === 'failed',
    };
  })();

  const dropoffDue = t.sellerDropoffDeadlineAt;
  const storeLocation = custodyPanel === null
    ? null
    : [custodyPanel.storeName ?? 'the delivery team', custodyPanel.storeArea, custodyPanel.storeAddress]
        .filter((part): part is string => part !== null)
        .join(', ');
  const settlementLabel = t.settlementMethod === null
    ? 'Not recorded'
    : paymentOption?.label ?? SETTLEMENT_LABELS[t.settlementMethod] ?? t.settlementMethod;
  const fulfillmentLabel = deliveryOption?.label ?? PATH_LABELS[t.fulfillmentPath] ?? t.fulfillmentPath;
  const myDisputes = disputeRows.filter((dispute) => dispute.raisedBy === viewer.userId);
  const hasOpenDispute = myDisputes.some((dispute) => dispute.status === 'open');
  const hasOtherOpenDispute = disputeRows.some((dispute) => dispute.raisedBy !== viewer.userId && dispute.status === 'open');

  return (
    <main className="deal-page">
      <div className="listing-head">
        <Link className="deal-page__back" href="/deals">
          <ArrowLeft aria-hidden="true" />
          My Deals
        </Link>
        <div className="deal-title-row">
          <h1><Link href={`/listings/${t.listingId}`}>{listing.title}</Link></h1>
          <strong className="deal-title-price num">{formatMoney(t.amountCents)}</strong>
        </div>
      </div>

      {flash.error !== undefined && (
        <div className="alert alert--error" role="alert">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v6m0 3.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>{flash.error}</span>
        </div>
      )}
      {flash.done === 'marked' && <div className="alert alert--info">Payment marked as sent. The deal has moved to the next step.</div>}
      {flash.done === 'collected' && <div className="alert alert--info">Collection confirmed. This deal is complete.</div>}
      {flash.done === 'handed-over' && <div className="alert alert--info">Hand-off recorded. The buyer has been notified to confirm receipt.</div>}
      {flash.done === 'received' && <div className="alert alert--info">Receipt confirmed. This deal is complete.</div>}
      {flash.done === 'meetup-complete' && <div className="alert alert--info">Meetup confirmed. This deal is complete.</div>}
      {flash.done === 'dispute-submitted' && <div className="alert alert--info" role="status">Your dispute was submitted. CollectTT support will review this deal.</div>}

      {contact !== null && (
        <section className="deal-contact-card" aria-labelledby="deal-contact-title">
          <div><Phone aria-hidden="true" /><h2 id="deal-contact-title">Contact {contact.displayName}</h2></div>
          <a href={`tel:${contact.phoneE164}`}>{contact.phoneE164}</a>
          <p>This number is private and available only because this transaction connects you.</p>
        </section>
      )}

      <div className="deal-room">
        <section className="deal-action-card" aria-labelledby="deal-action-title">
          {isOpen && isBuyer && t.fulfillmentPath === 'cash_meetup' && t.handoffState === 'awaiting_handoff' && (
            <>
              <p className="deal-action-card__eyebrow">Your next step</p>
              <h2 id="deal-action-title">Pay and collect the item</h2>
              <dl className="deal-action-card__facts">
                <div><CircleDollarSign aria-hidden="true" /><dt>Amount</dt><dd className="num">{formatMoney(t.amountCents)}</dd></div>
                <div><CreditCard aria-hidden="true" /><dt>Payment method</dt><dd>{settlementLabel}</dd></div>
                {meetupLocation !== null && <div><CalendarDays aria-hidden="true" /><dt>Meetup location</dt><dd>{meetupLocation.label} — {meetupLocation.area}</dd></div>}
              </dl>
              <p className="deal-action-card__help">Hand over the payment and take the item at the agreed meetup, then confirm once it is in your hands.</p>
              <form action={completeCashMeetupAction}>
                <input type="hidden" name="transactionId" value={id} />
                <button type="submit">I paid and collected the item</button>
              </form>
              <p className="deal-action-card__notice"><Bell aria-hidden="true" />This completes the deal and records it on both members’ trust activity.</p>
              {t.settlementMethod === 'bank_transfer' && <EvidenceUpload transactionId={id} />}
            </>
          )}

          {isOpen && isBuyer && t.paymentState === 'pending' && (t.fulfillmentPath !== 'cash_meetup' || t.handoffState === 'not_applicable') && (
            <>
              <p className="deal-action-card__eyebrow">Your next step</p>
              <h2 id="deal-action-title">Pay {counterpartyName}</h2>
              <dl className="deal-action-card__facts">
                <div><CircleDollarSign aria-hidden="true" /><dt>Amount</dt><dd className="num">{formatMoney(t.amountCents)}</dd></div>
                <div><CreditCard aria-hidden="true" /><dt>Payment method</dt><dd>{settlementLabel}</dd></div>
                <div><CalendarDays aria-hidden="true" /><dt>Payment due</dt><dd><time dateTime={t.paymentDeadlineAt.toISOString()}>{formatDateTime(t.paymentDeadlineAt)}</time></dd></div>
              </dl>
              <p className="deal-action-card__help">
                Pay using the method you agreed, then mark it here.
              </p>
              <form action={markPaidAction}>
                <input type="hidden" name="transactionId" value={id} />
                <button type="submit">Mark as paid</button>
              </form>
              <p className="deal-action-card__notice"><Bell aria-hidden="true" />This records payment and moves the deal forward immediately.</p>
              {t.settlementMethod === 'bank_transfer' && <EvidenceUpload transactionId={id} />}
            </>
          )}

          {isOpen && isBuyer && t.paymentState === 'buyer_marked_paid' && (t.fulfillmentPath !== 'cash_meetup' || t.handoffState === 'not_applicable') && (
            <>
              <p className="deal-action-card__eyebrow">One quick update</p>
              <h2 id="deal-action-title">Payment marked as sent</h2>
              <p className="deal-action-card__help">This deal was started under the previous payment flow. Continue once to move it forward without seller confirmation.</p>
              <form action={markPaidAction}><input type="hidden" name="transactionId" value={id} /><button type="submit">Continue deal</button></form>
            </>
          )}

          {isOpen && isBuyer && t.paymentState === 'confirmed' && (custodyPanel?.state === 'at_relay' || custodyPanel?.state === 'release_authorized') && (
            <>
              <p className="deal-action-card__eyebrow">Ready for collection</p>
              <h2 id="deal-action-title">Collect your item</h2>
              <dl className="deal-action-card__facts">
                <div><Store aria-hidden="true" /><dt>Collect from</dt><dd>{storeLocation}</dd></div>
                {custodyPanel.custodyExpiresAt !== null && <div><CalendarDays aria-hidden="true" /><dt>Collect by</dt><dd><time dateTime={custodyPanel.custodyExpiresAt.toISOString()}>{formatDateTime(custodyPanel.custodyExpiresAt)}</time></dd></div>}
              </dl>
              <span className="codebox" aria-label={`Collection code ${custodyPanel.dropoffCode}`}>
                <span className="codebox__label">Collection code</span>
                <span className="codebox__code">{custodyPanel.dropoffCode}</span>
              </span>
              <p className="deal-action-card__help">Collect the item from the store, then confirm once it is in your hands.</p>
              <form action={confirmCollectionAction}><input type="hidden" name="transactionId" value={id} /><button type="submit">I collected the item</button></form>
              <p className="deal-action-card__notice"><Bell aria-hidden="true" />This completes the deal. Only confirm after you have the item.</p>
            </>
          )}

          {isOpen && isSeller && t.paymentState === 'confirmed' && custodyPanel?.state === 'awaiting_dropoff' && (
            <>
              <p className="deal-action-card__eyebrow">Your next step</p>
              <h2 id="deal-action-title">Drop off the item</h2>
              <dl className="deal-action-card__facts">
                <div><Store aria-hidden="true" /><dt>Location</dt><dd>{storeLocation}</dd></div>
                {dropoffDue !== null && <div><CalendarDays aria-hidden="true" /><dt>Drop-off due</dt><dd><time dateTime={dropoffDue.toISOString()}>{formatDateTime(dropoffDue)}</time></dd></div>}
              </dl>
              <span className="codebox" aria-label={`Drop-off code ${custodyPanel.dropoffCode}`}>
                <span className="codebox__label">Drop-off code</span>
                <span className="codebox__code">{custodyPanel.dropoffCode}</span>
              </span>
              <p className="deal-action-card__notice"><Bell aria-hidden="true" />Show this code when you hand the item to the store.</p>
            </>
          )}

          {isOpen && isSeller && t.paymentState === 'pending' && (
            <>
              <p className="deal-action-card__eyebrow">Waiting on the buyer</p>
              <h2 id="deal-action-title">Payment has not been marked as sent</h2>
              <p className="deal-action-card__help">We’ll notify you when the buyer says they have paid.</p>
            </>
          )}

          {isOpen && isSeller && t.paymentState === 'buyer_marked_paid' && (
            <>
              <p className="deal-action-card__eyebrow">Payment recorded by buyer</p>
              <h2 id="deal-action-title">No confirmation needed</h2>
              <p className="deal-action-card__help">This older deal will move forward when the buyer next opens it. You do not need to verify the payment.</p>
            </>
          )}

          {isOpen && isSeller && t.paymentState === 'confirmed' && (custodyPanel?.state === 'at_relay' || custodyPanel?.state === 'release_authorized') && (
            <>
              <p className="deal-action-card__eyebrow">Waiting on {counterpartyName}</p>
              <h2 id="deal-action-title">Item ready for collection</h2>
              <p className="deal-action-card__help">The item is at {storeLocation}. The buyer will confirm after collecting it; the store does not need to release it in the app.</p>
            </>
          )}

          {isOpen && isSeller && t.fulfillmentPath === 'cash_meetup' && t.paymentState === 'confirmed' && t.handoffState === 'awaiting_handoff' && (
            <>
              <p className="deal-action-card__eyebrow">Waiting on {counterpartyName}</p>
              <h2 id="deal-action-title">Meetup pending</h2>
              <p className="deal-action-card__help">The buyer will confirm once they have paid and collected the item at the agreed meetup.</p>
            </>
          )}

          {isOpen && t.fulfillmentPath === 'cash_meetup' && t.handoffState === 'seller_handed_over' && isBuyer && (
            <>
              <p className="deal-action-card__eyebrow">Your next step</p>
              <h2 id="deal-action-title">Did you receive the item?</h2>
              <p className="deal-action-card__help">Confirm only after the meetup is complete. This closes the deal for both members.</p>
              <form action={confirmItemReceivedAction}><input type="hidden" name="transactionId" value={id} /><button type="submit">Item received</button></form>
            </>
          )}

          {isOpen && t.fulfillmentPath === 'cash_meetup' && t.handoffState === 'seller_handed_over' && isSeller && (
            <>
              <p className="deal-action-card__eyebrow">Waiting on {counterpartyName}</p>
              <h2 id="deal-action-title">Waiting for receipt confirmation</h2>
              <p className="deal-action-card__help">The buyer has until the receipt deadline to report a problem or confirm the item.</p>
            </>
          )}

          {isDisputed && (
            <>
              <p className="deal-action-card__eyebrow">Support review</p>
              <h2 id="deal-action-title">Deal under review</h2>
              <p className="deal-action-card__help">Automatic completion, expiry, and blame are paused while CollectTT reviews the reported issue.</p>
            </>
          )}

          {!isOpen && !isDisputed && (
            <>
              <p className="deal-action-card__eyebrow">{t.state === 'completed' ? 'Deal complete' : 'Deal closed'}</p>
              <h2 id="deal-action-title">{STATE_LABELS[t.state]}</h2>
              <p className="deal-action-card__help">{t.state === 'completed' ? 'This verified deal is included in both members’ trust activity.' : 'This deal is no longer active.'}</p>
            </>
          )}
        </section>

        {isOpen && custodyPanel?.state === 'awaiting_dropoff' && isBuyer && t.paymentState === 'confirmed' && (
          <section className="deal-dependency" aria-labelledby="deal-dependency-title">
            <Clock3 aria-hidden="true" />
            <div>
              <p>Waiting on {counterpartyName}</p>
              <h2 id="deal-dependency-title">Drop off at {custodyPanel.storeName ?? 'the delivery team'}</h2>
              {dropoffDue !== null && <strong>By <time dateTime={dropoffDue.toISOString()}>{formatDateTime(dropoffDue)}</time></strong>}
              <span>{counterpartyName} needs to drop the item off{custodyPanel.storeArea ? ` in ${custodyPanel.storeArea}` : ''}.</span>
            </div>
          </section>
        )}

        {isOpen && isSeller && t.paymentState === 'pending' && custodyPanel?.state === 'awaiting_dropoff' && (
          <section className="deal-dependency" aria-labelledby="deal-dependency-title">
            <Clock3 aria-hidden="true" />
            <div><p>Waiting on the buyer</p><h2 id="deal-dependency-title">Payment confirmation</h2><strong>Due {formatDateTime(t.paymentDeadlineAt)}</strong><span>The buyer still needs to mark {formatMoney(t.amountCents)} as paid.</span></div>
          </section>
        )}

        <section className="deal-status" aria-labelledby="deal-progress-title">
          <h2 id="deal-progress-title" className="deal-room__section-label">Deal progress</h2>
          <div className="deal-status__list">
            <div className="deal-status__steps"><Stepper steps={progress.steps} current={progress.current} off={progress.off} /></div>
          </div>
        </section>

        {evidenceRows.length > 0 && (
          <section className="deal-disclosure deal-evidence" aria-labelledby="deal-evidence-title">
            <h2 id="deal-evidence-title" className="deal-room__section-label">Payment evidence</h2>
            <p>Private to the two deal members and CollectTT support.</p>
            <ul>{evidenceRows.map((evidence) => <li key={evidence.id}><a href={`/api/deals/${id}/evidence/${evidence.id}`}>{evidence.originalFilename ?? 'Payment screenshot'}</a></li>)}</ul>
          </section>
        )}

        <details className="deal-disclosure">
          <summary><FileClock aria-hidden="true" /><strong>History</strong><ChevronDown aria-hidden="true" /></summary>
          <div className="deal-disclosure__body table-wrap">
            <table>
              <tbody>
                {timeline.map((event) => (
                  <tr key={event.id}>
                    <td className="muted deal-history__time"><time dateTime={event.occurredAt.toISOString()}><span>{formatHistoryDate(event.occurredAt).date}</span><span>{formatHistoryDate(event.occurredAt).time}</span></time></td>
                    <td className="deal-history__event"><span className={`deal-history__track deal-history__track--${event.track}`}>{humanize(event.track)}</span><span className="deal-history__transition">{humanize(event.fromState)} → {humanize(event.toState)}</span>{historyDescription(event, t) !== null && <span className="deal-history__description">{historyDescription(event, t)}</span>}</td>
                    <td className="deal-history__actor-cell"><span className={`deal-history__actor deal-history__actor--${event.actorRole}`}>{humanize(event.actorRole)}</span>{event.reason !== null && <span className="deal-history__reason">{historyReason(event.reason)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>

        <details className="deal-disclosure">
          <summary><Settings2 aria-hidden="true" /><strong>Deal details</strong><ChevronDown aria-hidden="true" /></summary>
          <div className="deal-disclosure__body deal-details__grid">
            <div className="deal-detail"><span>Status</span><strong className={`badge ${t.state === 'completed' ? 'badge--live' : t.state === 'open' ? 'badge--claimed' : 'badge--ended'}`}>{STATE_LABELS[t.state]}</strong></div>
            <div className="deal-detail">
              <span>{counterpartyRole}</span>
              <strong>
                <UserRound aria-hidden="true" />
                {counterpartySnapshot === null ? (
                  <span>{counterpartyName}</span>
                ) : (
                  <BuyerSnapshotLink
                    snapshot={serializeTrustSnapshot(counterpartySnapshot)}
                    subjectLabel={counterpartyRole}
                    triggerClassName="deal-detail__profile-link"
                    triggerLabel={counterpartyName}
                    showTriggerIcon={false}
                  />
                )}
              </strong>
            </div>
            <div className="deal-detail"><span>Fulfillment</span><strong>{fulfillmentLabel}</strong></div>
            {meetupLocation !== null && <div className="deal-detail"><span>Meetup location</span><strong>{meetupLocation.label} — {meetupLocation.area}</strong></div>}
            <div className="deal-detail"><span>Payment method</span><strong>{settlementLabel}</strong></div>
            {t.attemptNumber > 1 && <div className="deal-detail"><span>Attempt</span><strong>{t.attemptNumber}</strong></div>}
          </div>
        </details>

        <section className="deal-support" aria-labelledby="deal-support-title">
          <div className="deal-support__heading">
            <div>
              <p className="deal-room__section-label">Need help with this deal?</p>
              <h2 id="deal-support-title">Report an issue</h2>
              <p>Tell CollectTT what went wrong. We’ll create a support record and notify the other member.</p>
            </div>
            <AlertTriangle aria-hidden="true" />
          </div>

          {hasOtherOpenDispute && <p className="deal-support__notice">The other member has reported an issue with this deal. We’ll let you know when support records a decision.</p>}

          {myDisputes.length > 0 && (
            <div className="deal-support__history" aria-label="Your dispute history">
              {myDisputes.map((dispute) => (
                <article className="deal-support__report" key={dispute.id}>
                  <div>
                    <strong>{DISPUTE_REASON_LABELS[dispute.reason as keyof typeof DISPUTE_REASON_LABELS] ?? humanize(dispute.reason)}</strong>
                    <span className={`deal-support__status deal-support__status--${dispute.status}`}>{humanize(dispute.status)}</span>
                  </div>
                  <p>{dispute.detail}</p>
                  {dispute.resolution !== null && <small>Support response: {dispute.resolution}</small>}
                </article>
              ))}
            </div>
          )}

          {hasOpenDispute ? (
            <p className="deal-support__notice">Your report is open. You can add more context after support reviews this one.</p>
          ) : (
            <form className="deal-support__form" action={submitDisputeAction}>
              <input type="hidden" name="transactionId" value={id} />
              <label htmlFor="dispute-reason">What went wrong?</label>
              <select id="dispute-reason" name="reason" required defaultValue="">
                <option value="" disabled>Select an issue</option>
                {DISPUTE_REASONS.map((reason) => <option key={reason} value={reason}>{DISPUTE_REASON_LABELS[reason]}</option>)}
              </select>
              <label htmlFor="dispute-detail">Tell us what happened</label>
              <textarea id="dispute-detail" name="detail" required minLength={10} maxLength={2000} rows={5} aria-describedby="dispute-detail-help" />
              <p id="dispute-detail-help">Include the key facts, dates, and any agreed next step. 10 to 2,000 characters.</p>
              <button type="submit">Submit dispute</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
