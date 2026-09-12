import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { and, eq, asc } from 'drizzle-orm';
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileClock,
  Package,
  Settings2,
  Store,
  UserRound,
} from 'lucide-react';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { transactions, transactionEvents } from '@/db/schema/transactions';
import { listings } from '@/db/schema/listings';
import { marketplaceOptions } from '@/db/schema/settings';
import { custodyPanelFor } from '@/services/custody';
import { trustSnapshotsForMembers } from '@/services/reputation';
import { formatMoney } from '@/domain/money';
import { usesCustodyTrack } from '@/domain/states/transaction';
import {
  markPaidAction,
  confirmPaymentAction,
  disputePaymentAction,
} from './actions';
import { serializeTrustSnapshot } from '../buyer-snapshot-data';
import { BuyerSnapshotLink } from '../buyer-snapshot-link';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Meet in person',
  remote_ship: 'Seller ships to you',
  relay: 'Pick up at a store',
  full_service: 'CollectTT delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Awaiting payment',
  buyer_marked_paid: 'Buyer says they paid',
  confirmed: 'Payment confirmed',
  failed: 'Payment failed',
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

const PAYMENT_STEPS = ['Awaiting payment', 'Marked paid', 'Confirmed'];
const PAYMENT_INDEX: Record<string, number> = { pending: 0, buyer_marked_paid: 1, confirmed: 2 };

const CUSTODY_STEPS = ['Awaiting drop-off', 'On the shelf', 'Collected'];
const CUSTODY_INDEX: Record<string, number> = {
  awaiting_dropoff: 0,
  at_relay: 1,
  release_authorized: 1,
  picked_up: 2,
};

const CUSTODY_LABELS: Record<string, string> = {
  awaiting_dropoff: 'Awaiting drop-off',
  at_relay: 'On the shelf',
  release_authorized: 'Ready for pickup',
  picked_up: 'Collected',
  returned_to_seller: 'Returned to seller',
  voided: 'Drop-off cancelled',
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
  if (value === 'claim') return 'Claim opened';
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
      return `The buyer claimed the listing. Payment was due by ${formatDateTime(deal.paymentDeadlineAt)}${usesCustodyTrack(deal.fulfillmentPath) ? '; seller drop-off was not required until payment was confirmed' : ''}.`;
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

  const [deliveryOption, paymentOption] = await Promise.all([
    t.deliveryOptionId === null
      ? Promise.resolve(null)
      : db.select({ label: marketplaceOptions.label }).from(marketplaceOptions).where(eq(marketplaceOptions.id, t.deliveryOptionId)).limit(1).then((rows) => rows[0] ?? null),
    t.settlementMethod === null
      ? Promise.resolve(null)
      : db.select({ label: marketplaceOptions.label }).from(marketplaceOptions).where(and(
          eq(marketplaceOptions.kind, 'payment'),
          eq(marketplaceOptions.key, t.settlementMethod),
        )).limit(1).then((rows) => rows[0] ?? null),
  ]);

  const counterpartyId = isBuyer ? t.sellerId : t.buyerId;
  const counterpartySnapshot = (await trustSnapshotsForMembers(db, [counterpartyId])).get(counterpartyId) ?? null;
  const counterpartyName = counterpartySnapshot?.displayName ?? 'the other member';
  const counterpartyRole: 'Seller' | 'Buyer' = isBuyer ? 'Seller' : 'Buyer';

  const timeline = await db
    .select()
    .from(transactionEvents)
    .where(eq(transactionEvents.transactionId, id))
    .orderBy(asc(transactionEvents.occurredAt));

  const isOpen = t.state === 'open';
  const hasCustody = usesCustodyTrack(t.fulfillmentPath);
  const custodyPanel = hasCustody ? await custodyPanelFor(db, id) : null;

  const paymentIdx = PAYMENT_INDEX[t.paymentState] ?? 0;
  const paymentFailed = t.paymentState === 'failed';
  const custodyIdx = CUSTODY_INDEX[t.custodyState] ?? 0;
  const custodyOff = t.custodyState === 'returned_to_seller' || t.custodyState === 'voided';

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
      {flash.done === 'marked' && <div className="alert alert--info">Marked as paid. {counterpartyName} has been notified.</div>}
      {flash.done === 'confirmed' && <div className="alert alert--info">Payment confirmed.</div>}
      {flash.done === 'disputed' && <div className="alert alert--warn">Recorded. The buyer has been told nothing arrived.</div>}

      <div className="deal-room">
        <section className="deal-action-card" aria-labelledby="deal-action-title">
          {isOpen && isBuyer && t.paymentState === 'pending' && (
            <>
              <p className="deal-action-card__eyebrow">Your next step</p>
              <h2 id="deal-action-title">Pay {counterpartyName}</h2>
              <dl className="deal-action-card__facts">
                <div><CircleDollarSign aria-hidden="true" /><dt>Amount</dt><dd className="num">{formatMoney(t.amountCents)}</dd></div>
                <div><CreditCard aria-hidden="true" /><dt>Payment method</dt><dd>{settlementLabel}</dd></div>
                <div><CalendarDays aria-hidden="true" /><dt>Payment due</dt><dd><time dateTime={t.paymentDeadlineAt.toISOString()}>{formatDateTime(t.paymentDeadlineAt)}</time></dd></div>
              </dl>
              <p className="deal-action-card__help">
                Pay using the method you agreed{t.fulfillmentPath === 'cash_meetup' ? ', or hand over cash when you meet' : ''}, then mark it here.
              </p>
              <form action={markPaidAction}>
                <input type="hidden" name="transactionId" value={id} />
                <button type="submit">Mark as paid</button>
              </form>
              <p className="deal-action-card__notice"><Bell aria-hidden="true" />Marking as paid notifies {counterpartyName}.</p>
            </>
          )}

          {isOpen && isBuyer && t.paymentState === 'buyer_marked_paid' && (
            <>
              <p className="deal-action-card__eyebrow">Waiting on {counterpartyName}</p>
              <h2 id="deal-action-title">Payment marked as sent</h2>
              <p className="deal-action-card__help">The seller needs to confirm the money arrived. There is nothing else for you to do right now.</p>
              <p className="deal-action-card__notice"><Bell aria-hidden="true" />We’ll let you know when the seller responds.</p>
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
              <p className="deal-action-card__eyebrow">Your next step</p>
              <h2 id="deal-action-title">Did the money arrive?</h2>
              <p className="deal-action-card__help">Confirm only after you can see the payment. Saying no returns the deal to awaiting payment without extending the deadline.</p>
              <div className="deal-action-card__button-group">
                <form action={confirmPaymentAction}>
                  <input type="hidden" name="transactionId" value={id} />
                  <button type="submit">Yes, I received it</button>
                </form>
                <form action={disputePaymentAction}>
                  <input type="hidden" name="transactionId" value={id} />
                  <button className="secondary" type="submit">No, nothing arrived</button>
                </form>
              </div>
            </>
          )}

          {!isOpen && (
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
            <details>
              <summary>
                <span className="deal-status__icon"><CreditCard aria-hidden="true" /></span>
                <strong>Payment</strong>
                <span className={paymentFailed ? 'is-off' : ''}>{PAYMENT_LABELS[t.paymentState]}</span>
                <ChevronDown aria-hidden="true" />
              </summary>
              <div className="deal-status__steps"><Stepper steps={PAYMENT_STEPS} current={paymentFailed ? 0 : paymentIdx} off={paymentFailed} /></div>
            </details>
            {hasCustody && (
              <details>
                <summary>
                  <span className="deal-status__icon"><Package aria-hidden="true" /></span>
                  <strong>Item</strong>
                  <span className={custodyOff ? 'is-off' : ''}>{CUSTODY_LABELS[t.custodyState] ?? humanize(t.custodyState)}</span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="deal-status__steps"><Stepper steps={CUSTODY_STEPS} current={custodyIdx} off={custodyOff} /></div>
              </details>
            )}
          </div>
        </section>

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
            <div className="deal-detail"><span>Payment method</span><strong>{settlementLabel}</strong></div>
            {t.attemptNumber > 1 && <div className="deal-detail"><span>Attempt</span><strong>{t.attemptNumber}</strong></div>}
          </div>
        </details>
      </div>
    </main>
  );
}
