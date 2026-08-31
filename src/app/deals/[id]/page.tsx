import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { transactions, transactionEvents } from '@/db/schema/transactions';
import { listings } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { ratingsFor } from '@/services/ratings';
import { custodyPanelFor } from '@/services/custody';
import { formatMoney } from '@/domain/money';
import { usesCustodyTrack } from '@/domain/states/transaction';
import {
  markPaidAction,
  confirmPaymentAction,
  disputePaymentAction,
  rateAction,
} from './actions';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Cash on meetup',
  remote_ship: 'Remote payment + seller ships',
  relay: 'Store drop-off',
  full_service: 'Pickup & delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Awaiting payment',
  buyer_marked_paid: 'Buyer says they paid',
  confirmed: 'Payment confirmed',
  failed: 'Payment failed',
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

function Stepper({ steps, current, off }: { steps: string[]; current: number; off: boolean }) {
  return (
    <div className="steps">
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
          <div className={cls} key={label}>
            <span className="step__dot" />
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

  const timeline = await db
    .select()
    .from(transactionEvents)
    .where(eq(transactionEvents.transactionId, id))
    .orderBy(asc(transactionEvents.occurredAt));

  const ratings = t.state === 'completed' ? await ratingsFor(id, viewer.userId) : null;
  const isOpen = t.state === 'open';
  const hasCustody = usesCustodyTrack(t.fulfillmentPath);
  const custodyPanel = hasCustody ? await custodyPanelFor(db, id) : null;

  const paymentIdx = PAYMENT_INDEX[t.paymentState] ?? 0;
  const paymentFailed = t.paymentState === 'failed';
  const custodyIdx = CUSTODY_INDEX[t.custodyState] ?? 0;
  const custodyOff = t.custodyState === 'returned_to_seller' || t.custodyState === 'voided';

  const dropoffDue = t.sellerDropoffDeadlineAt;

  return (
    <main>
      <div className="listing-head">
        <Link className="breadcrumb" href={`/listings/${t.listingId}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {listing.title}
        </Link>
        <h1 className="num">{formatMoney(t.amountCents)}</h1>
        <div className="badge-row">
          <span className={`badge ${t.state === 'completed' ? 'badge--live' : t.state === 'open' ? 'badge--claimed' : 'badge--ended'}`}>
            {STATE_LABELS[t.state]}
          </span>
          <span className="badge">{PATH_LABELS[t.fulfillmentPath]}</span>
          {t.attemptNumber > 1 && <span className="badge">Attempt {t.attemptNumber}</span>}
        </div>
        <p className="deal-sub">
          You are the <strong>{isBuyer ? 'buyer' : 'seller'}</strong> · counterparty{' '}
          <Link href={`/members/${counterpartyId}`}>{counterpartyName}</Link>
        </p>
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
      {flash.done === 'rated' && <div className="alert alert--info">Rating submitted.</div>}

      <div className="listing-body">
        {/* -------------------------------------------------- tracks + item + history */}
        <div>
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
              <div className="track">
                <div className="track__head">
                  <span className="track__title">Custody · the item</span>
                  <span className={`track__now${custodyOff ? ' track__now--off' : ''}`}>
                    {t.custodyState.replace(/_/g, ' ')}
                  </span>
                </div>
                <Stepper steps={CUSTODY_STEPS} current={custodyIdx} off={custodyOff} />
              </div>
            )}
          </div>

          {hasCustody && custodyPanel !== null && (
            <>
              <h2 className="section-label">Where your item is</h2>
              <div className="card">
                {custodyPanel.state === 'awaiting_dropoff' && isSeller && (
                  <>
                    <p style={{ marginTop: 0 }}>
                      Drop it off at{' '}
                      <strong>
                        {[custodyPanel.storeName ?? 'the delivery team', custodyPanel.storeArea, custodyPanel.storeAddress]
                          .filter((part): part is string => part !== null)
                          .join(', ')}
                      </strong>
                      . Quote this code at the counter:
                    </p>
                    <span className="codebox">
                      <span className="codebox__label">Drop-off code</span>
                      <span className="codebox__code">{custodyPanel.dropoffCode}</span>
                    </span>
                    {dropoffDue !== null && (
                      <p className="muted" style={{ marginBottom: 0 }}>
                        Drop it off by {dropoffDue.toLocaleString('en-TT')}.
                      </p>
                    )}
                  </>
                )}

                {custodyPanel.state === 'awaiting_dropoff' && isBuyer && (
                  <p style={{ margin: 0 }} className="muted">
                    Waiting for {counterpartyName} to drop it off at{' '}
                    {custodyPanel.storeName ?? 'the delivery team'}.
                  </p>
                )}

                {custodyPanel.state === 'at_relay' && isBuyer && (
                  <>
                    <p style={{ marginTop: 0 }}>
                      Your item is at <strong>{custodyPanel.storeName ?? 'the delivery team'}</strong>.
                      {t.paymentState === 'confirmed'
                        ? ' Show this code to collect it:'
                        : ' Confirm your payment and the store will release it. Show this code to collect:'}
                    </p>
                    <span className="codebox">
                      <span className="codebox__label">Your collection code</span>
                      <span className="codebox__code">{custodyPanel.dropoffCode}</span>
                    </span>
                    {t.paymentState === 'confirmed' && custodyPanel.custodyExpiresAt !== null && (
                      <p className="muted" style={{ marginBottom: 0 }}>
                        Collect by {custodyPanel.custodyExpiresAt.toLocaleString('en-TT')}.
                      </p>
                    )}
                  </>
                )}

                {custodyPanel.state === 'at_relay' && isSeller && (
                  <p style={{ margin: 0 }} className="muted">
                    Dropped off at {custodyPanel.storeName ?? 'the delivery team'}. Waiting for the
                    buyer to collect it.
                  </p>
                )}

                {custodyPanel.state === 'release_authorized' && isBuyer && (
                  <>
                    <p style={{ marginTop: 0 }}>
                      Cleared for collection at{' '}
                      <strong>{custodyPanel.storeName ?? 'the delivery team'}</strong>. Show this code:
                    </p>
                    <span className="codebox">
                      <span className="codebox__label">Collection code</span>
                      <span className="codebox__code">{custodyPanel.dropoffCode}</span>
                    </span>
                  </>
                )}

                {custodyPanel.state === 'release_authorized' && isSeller && (
                  <p style={{ margin: 0 }} className="muted">
                    Cleared for collection at {custodyPanel.storeName ?? 'the delivery team'}. Waiting
                    for the buyer to pick it up.
                  </p>
                )}

                {custodyPanel.state === 'picked_up' && (
                  <p style={{ margin: 0 }}>
                    {isBuyer ? 'You collected this' : 'The buyer collected this'} from{' '}
                    {custodyPanel.storeName ?? 'the delivery team'}.
                  </p>
                )}

                {custodyPanel.state === 'returned_to_seller' && (
                  <p style={{ margin: 0 }}>This item went back to the seller.</p>
                )}
                {custodyPanel.state === 'voided' && (
                  <p style={{ margin: 0 }}>This item was never dropped off.</p>
                )}
              </div>
            </>
          )}

          <h2 className="section-label">History</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {timeline.map((event) => (
                  <tr key={event.id}>
                    <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {event.occurredAt.toLocaleString('en-TT')}
                    </td>
                    <td>
                      {event.track}: {event.fromState} → {event.toState}
                    </td>
                    <td className="muted">
                      {event.actorRole}
                      {event.reason !== null && ` · ${event.reason}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* -------------------------------------------------- action rail */}
        <aside className="buybox">
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
          ) : t.state === 'completed' && ratings !== null ? (
            <>
              <p className="movebox__label">Deal complete</p>
              <p className="movebox__cta">Rate this deal</p>
              {ratings.mine === null ? (
                <form className="buybox__form" action={rateAction}>
                  <input type="hidden" name="transactionId" value={id} />
                  <label htmlFor="stars">Stars</label>
                  <select id="stars" name="stars" defaultValue="5">
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {'★'.repeat(n)}
                        {'☆'.repeat(5 - n)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="comment">Comment (optional)</label>
                  <textarea id="comment" name="comment" maxLength={1000} />
                  <p className="buybox__note">
                    Blind — neither of you sees the other&apos;s rating until you&apos;ve both
                    submitted, or the window closes{' '}
                    {t.ratingWindowEndsAt !== null
                      ? `on ${t.ratingWindowEndsAt.toLocaleDateString('en-TT')}`
                      : 'at the deadline'}
                    .
                  </p>
                  <button type="submit">Submit rating</button>
                </form>
              ) : (
                <div className="buybox__state">
                  You rated this {'★'.repeat(ratings.mine.stars)}
                  {'☆'.repeat(5 - ratings.mine.stars)}.
                </div>
              )}
              <div className="buybox__state" style={{ marginTop: '.6rem' }}>
                {ratings.theirs !== null ? (
                  <>
                    They rated you {'★'.repeat(ratings.theirs.stars)}
                    {'☆'.repeat(5 - ratings.theirs.stars)}
                    {ratings.theirs.comment !== null && <> — “{ratings.theirs.comment}”</>}
                  </>
                ) : ratings.theirsPending ? (
                  'They have rated you — hidden until you submit yours.'
                ) : (
                  'They haven’t rated yet.'
                )}
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
              <dt>Counterparty</dt>
              <dd>
                <Link href={`/members/${counterpartyId}`}>{counterpartyName}</Link>
              </dd>
            </div>
            {isOpen && t.paymentState === 'pending' && (
              <div className="fact-row fact-row--warn">
                <dt>Payment due</dt>
                <dd className="num">{t.paymentDeadlineAt.toLocaleString('en-TT')}</dd>
              </div>
            )}
            {dropoffDue !== null && isOpen && (
              <div className="fact-row">
                <dt>Deliver by</dt>
                <dd className="num">{dropoffDue.toLocaleString('en-TT')}</dd>
              </div>
            )}
          </dl>

          <div className="trust">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>
              <strong>You pay each other directly.</strong> CollectTT never handles the money — it
              only records what you both say happened.
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}
