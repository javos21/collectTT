import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { transactions, transactionEvents } from '@/db/schema/transactions';
import { listings } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { custodyPanelFor } from '@/services/custody';
import { formatMoney } from '@/domain/money';
import { usesCustodyTrack } from '@/domain/states/transaction';
import {
  markPaidAction,
  confirmPaymentAction,
  disputePaymentAction,
} from './actions';

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

const CUSTODY_STEPS = ['Awaiting drop-off', 'On the shelf', 'Cleared for release', 'Collected'];
const CUSTODY_INDEX: Record<string, number> = {
  awaiting_dropoff: 0,
  at_relay: 1,
  release_authorized: 2,
  picked_up: 3,
};

const CUSTODY_LABELS: Record<string, string> = {
  awaiting_dropoff: 'Awaiting drop-off',
  at_relay: 'On the shelf',
  release_authorized: 'Cleared for release',
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

  const counterpartyId = isBuyer ? t.sellerId : t.buyerId;
  const counterparty = (
    await db
      .select({ name: profiles.displayName, since: profiles.memberSince })
      .from(profiles)
      .where(eq(profiles.userId, counterpartyId))
      .limit(1)
  )[0];
  const counterpartyName = counterparty?.name ?? 'the other member';
  const counterpartyRole = isBuyer ? 'Seller' : 'Buyer';

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

  return (
    <main className="deal-page">
      <div className="listing-head">
        <div className="deal-title-row">
          <Link className="breadcrumb" href={`/listings/${t.listingId}`}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{listing.title}</span>
          </Link>
          <h1 className="num">{formatMoney(t.amountCents)}</h1>
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

      <div className="listing-body">
        {/* -------------------------------------------------- tracks + item + history */}
        <div className="deal-progress">
          <h2 className="section-label" style={{ marginTop: 0 }}>Progress</h2>
          <div className="tracks">
            <div className="track">
              <div className="track__head">
                <span className="track__title">Payment · the money</span>
                <span className={`track__now${paymentFailed ? ' track__now--off' : ''}`}>
                  {PAYMENT_LABELS[t.paymentState]}
                </span>
              </div>
              <Stepper steps={PAYMENT_STEPS} current={paymentFailed ? 0 : paymentIdx} off={paymentFailed} />
            </div>

            {hasCustody && (
              <div className="track track--custody">
                <div className="track__head">
                  <span className="track__title">Custody · the item</span>
                  <span className={`track__now${custodyOff ? ' track__now--off' : ''}`}>
                    {CUSTODY_LABELS[t.custodyState] ?? humanize(t.custodyState)}
                  </span>
                </div>
                <Stepper steps={CUSTODY_STEPS} current={custodyIdx} off={custodyOff} />

                {custodyPanel !== null && (
                  <div className="track__detail">
                {custodyPanel.state === 'awaiting_dropoff' && isSeller && (
                  <div className="custody-instruction">
                      <div className="custody-instruction__copy">
                      <p>
                        <strong>{storeLocation}</strong>
                      </p>
                      {dropoffDue !== null && (
                        <p className="custody-instruction__deadline">
                          Drop off by <time dateTime={dropoffDue.toISOString()}>{formatDateTime(dropoffDue)}</time>
                        </p>
                      )}
                    </div>
                    <span className="codebox" aria-label={`Drop-off code ${custodyPanel.dropoffCode}`}>
                      <span className="codebox__label">Drop-off code</span>
                      <span className="codebox__code">{custodyPanel.dropoffCode}</span>
                    </span>
                  </div>
                )}

                {custodyPanel.state === 'awaiting_dropoff' && isBuyer && (
                  <div className="custody-status-note">
                    <strong>Waiting for the seller</strong>
                    <p>
                      {counterpartyName} needs to drop the item off at{' '}
                      {custodyPanel.storeName ?? 'the delivery team'}
                      {dropoffDue !== null && (
                        <> by <time dateTime={dropoffDue.toISOString()}>{formatDateTime(dropoffDue)}</time></>
                      )}.
                    </p>
                  </div>
                )}

                {custodyPanel.state === 'at_relay' && isBuyer && (
                  <div className="custody-instruction">
                    <div className="custody-instruction__copy">
                    <strong>Collect your item</strong>
                    <p>
                      Your item is at <strong>{custodyPanel.storeName ?? 'the delivery team'}</strong>.
                      {t.paymentState === 'confirmed'
                        ? ' Show this code to collect it:'
                        : ' Confirm your payment and the store will release it. Show this code to collect:'}
                    </p>
                    {t.paymentState === 'confirmed' && custodyPanel.custodyExpiresAt !== null && (
                      <p className="custody-instruction__deadline">
                        Collect by <time dateTime={custodyPanel.custodyExpiresAt.toISOString()}>{formatDateTime(custodyPanel.custodyExpiresAt)}</time>
                      </p>
                    )}
                    </div>
                    <span className="codebox" aria-label={`Collection code ${custodyPanel.dropoffCode}`}>
                      <span className="codebox__label">Your collection code</span>
                      <span className="codebox__code">{custodyPanel.dropoffCode}</span>
                    </span>
                  </div>
                )}

                {custodyPanel.state === 'at_relay' && isSeller && (
                  <div className="custody-status-note">
                    <strong>Item received by the store</strong>
                    <p>Dropped off at {custodyPanel.storeName ?? 'the delivery team'}. Waiting for the buyer to collect it.</p>
                  </div>
                )}

                {custodyPanel.state === 'release_authorized' && isBuyer && (
                  <div className="custody-instruction">
                    <div className="custody-instruction__copy">
                    <strong>Collect your item</strong>
                    <p>
                      Cleared for collection at{' '}
                      <strong>{custodyPanel.storeName ?? 'the delivery team'}</strong>. Show this code:
                    </p>
                    </div>
                    <span className="codebox" aria-label={`Collection code ${custodyPanel.dropoffCode}`}>
                      <span className="codebox__label">Collection code</span>
                      <span className="codebox__code">{custodyPanel.dropoffCode}</span>
                    </span>
                  </div>
                )}

                {custodyPanel.state === 'release_authorized' && isSeller && (
                  <div className="custody-status-note">
                    <strong>Ready for the buyer</strong>
                    <p>Cleared for collection at {custodyPanel.storeName ?? 'the delivery team'}. Waiting for the buyer to pick it up.</p>
                  </div>
                )}

                {custodyPanel.state === 'picked_up' && (
                  <div className="custody-status-note custody-status-note--complete">
                    <strong>Item collected</strong>
                    <p>{isBuyer ? 'You collected this' : 'The buyer collected this'} from {custodyPanel.storeName ?? 'the delivery team'}.</p>
                  </div>
                )}

                {custodyPanel.state === 'returned_to_seller' && (
                  <div className="custody-status-note"><strong>Returned to seller</strong><p>This item went back to the seller.</p></div>
                )}
                {custodyPanel.state === 'voided' && (
                  <div className="custody-status-note"><strong>Drop-off cancelled</strong><p>This item was never dropped off.</p></div>
                )}
                  </div>
                )}
              </div>
            )}
          </div>

          <h2 className="section-label">History</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {timeline.map((event) => (
                  <tr key={event.id}>
                    <td className="muted deal-history__time">
                      <time dateTime={event.occurredAt.toISOString()}>
                        <span>{formatHistoryDate(event.occurredAt).date}</span>
                        <span>{formatHistoryDate(event.occurredAt).time}</span>
                      </time>
                    </td>
                    <td className="deal-history__event">
                      <span className={`deal-history__track deal-history__track--${event.track}`}>{humanize(event.track)}</span>
                      <span className="deal-history__transition">{humanize(event.fromState)} → {humanize(event.toState)}</span>
                    </td>
                    <td className="deal-history__actor-cell">
                      <span className={`deal-history__actor deal-history__actor--${event.actorRole}`}>{humanize(event.actorRole)}</span>
                      {event.reason !== null && <span className="deal-history__reason">{humanize(event.reason)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* -------------------------------------------------- action rail */}
        <aside className="buybox action-grid">
          <div className="action-grid__heading">
            <span className="action-grid__eyebrow">Action grid</span>
            <span className="action-grid__hint">What happens next</span>
          </div>
          {isOpen && hasCustody && custodyPanel?.state === 'awaiting_dropoff' && isSeller && (
            <div className="action-grid__task">
              <span>Next move</span>
              <strong>Drop off the item</strong>
              <p>{storeLocation}</p>
            </div>
          )}
          {isOpen && hasCustody && custodyPanel?.state === 'awaiting_dropoff' && isBuyer && (
            <div className="action-grid__task">
              <span>Next move</span>
              <strong>Wait for the seller</strong>
              <p>{counterpartyName} will drop it off at {storeLocation}.</p>
            </div>
          )}
          {isOpen ? (
            <>
              {isBuyer && t.paymentState === 'pending' && (
                <form className="buybox__form" action={markPaidAction}>
                  <input type="hidden" name="transactionId" value={id} />
                  <p className="movebox__label">Your move</p>
                  <p className="movebox__cta">Pay {counterpartyName}, then mark it here</p>
                  <p className="buybox__note" style={{ marginTop: 0 }}>
                    Cash, bank transfer, however you agreed
                    {t.fulfillmentPath === 'cash_meetup' && ' — or meet up and hand over cash'}. They
                    then confirm it arrived.
                  </p>
                  <button type="submit">I&apos;ve paid</button>
                </form>
              )}

              {isBuyer && t.paymentState === 'buyer_marked_paid' && (
                <>
                  <p className="movebox__label">Waiting on {counterpartyName}</p>
                  <p className="movebox__cta">They need to confirm they got it</p>
                  <div className="buybox__state">
                    Nothing to do right now — the seller confirms the money arrived, then you&apos;re
                    both done.
                  </div>
                </>
              )}

              {isSeller && t.paymentState === 'pending' && (
                <>
                  <p className="movebox__label">Waiting on the buyer</p>
                  <p className="movebox__cta">They need to pay first</p>
                  <div className="buybox__state">
                    If the deadline passes, it&apos;s recorded against them and the item moves to the
                    next person in the queue automatically.
                  </div>
                </>
              )}

              {isSeller && t.paymentState === 'buyer_marked_paid' && (
                <>
                  <p className="movebox__label">Your move</p>
                  <p className="movebox__cta">Did the money actually arrive?</p>
                  <p className="buybox__note" style={{ marginTop: 0 }}>
                    Confirm only if you&apos;ve seen it. Saying no returns the deal to awaiting
                    payment and does <em>not</em> extend the buyer&apos;s deadline.
                  </p>
                  <div className="buybox__form" style={{ display: 'grid', gap: '.6rem' }}>
                    <form action={confirmPaymentAction}>
                      <input type="hidden" name="transactionId" value={id} />
                      <button type="submit" style={{ width: '100%', marginTop: 0 }}>
                        Yes, I received it
                      </button>
                    </form>
                    <form action={disputePaymentAction}>
                      <input type="hidden" name="transactionId" value={id} />
                      <button className="secondary" type="submit" style={{ width: '100%', marginTop: 0 }}>
                        No, nothing arrived
                      </button>
                    </form>
                  </div>
                </>
              )}
            </>
          ) : t.state === 'completed' ? (
            <>
              <p className="movebox__label">Deal complete</p>
              <p className="movebox__cta">Transaction completed</p>
              <div className="buybox__state">
                This deal is complete. Its verified activity is included in both members&apos;
                trust snapshots.
              </div>
            </>
          ) : (
            <>
              <p className="movebox__label">Closed</p>
              <p className="movebox__cta">{STATE_LABELS[t.state]}</p>
              <div className="buybox__state">This deal is no longer active.</div>
            </>
          )}

          <hr />
          <dl style={{ margin: 0 }}>
            <div className="fact-row" style={{ borderTop: 'none' }}>
              <dt>{counterpartyRole}</dt>
              <dd className="fact-row__value">
                <svg className="fact-row__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M5.5 20c.8-3.2 3-4.8 6.5-4.8s5.7 1.6 6.5 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <Link href={`/members/${counterpartyId}`}>{counterpartyName}</Link>
              </dd>
            </div>
            {isOpen && t.paymentState === 'pending' && (
              <div className="fact-row fact-row--warn">
                <dt>Payment due</dt>
                <dd className="num">{formatDateTime(t.paymentDeadlineAt)}</dd>
              </div>
            )}
          </dl>

        </aside>
      </div>

      <section className="deal-details" aria-labelledby="deal-details-title">
        <h2 id="deal-details-title" className="deal-details__label">Deal details</h2>
        <div className="deal-details__grid">
          <div className="deal-detail">
            <span>Status</span>
            <strong className={`badge ${t.state === 'completed' ? 'badge--live' : t.state === 'open' ? 'badge--claimed' : 'badge--ended'}`}>
              {STATE_LABELS[t.state]}
            </strong>
          </div>
          <div className="deal-detail">
            <span>Fulfillment</span>
            <strong>{PATH_LABELS[t.fulfillmentPath]}</strong>
          </div>
          {t.settlementMethod !== null && (
            <div className="deal-detail">
              <span>Payment method</span>
              <strong>{SETTLEMENT_LABELS[t.settlementMethod] ?? t.settlementMethod}</strong>
            </div>
          )}
          {t.attemptNumber > 1 && (
            <div className="deal-detail">
              <span>Attempt</span>
              <strong>{t.attemptNumber}</strong>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
