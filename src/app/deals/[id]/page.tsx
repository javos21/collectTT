import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { transactions, transactionEvents } from '@/db/schema/transactions';
import { listings } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { ratingsFor } from '@/services/ratings';
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
  relay: 'Relay store drop-off',
  full_service: 'Pickup & delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Awaiting payment',
  buyer_marked_paid: 'Buyer says they paid — awaiting seller confirmation',
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

  const timeline = await db
    .select()
    .from(transactionEvents)
    .where(eq(transactionEvents.transactionId, id))
    .orderBy(asc(transactionEvents.occurredAt));

  const ratings = t.state === 'completed' ? await ratingsFor(id, viewer.userId) : null;
  const isOpen = t.state === 'open';

  return (
    <main>
      <p className="muted">
        <Link href={`/listings/${t.listingId}`}>← {listing.title}</Link>
      </p>

      <h1>{formatMoney(t.amountCents)}</h1>
      <p className="muted">
        <span className="pill">{STATE_LABELS[t.state]}</span>{' '}
        <span className="pill">{PATH_LABELS[t.fulfillmentPath]}</span>
        {t.attemptNumber > 1 && <> <span className="pill">attempt {t.attemptNumber}</span></>}
      </p>

      {flash.error !== undefined && <p className="error">{flash.error}</p>}
      {flash.done === 'marked' && <p className="ok">Marked as paid. The seller has been notified.</p>}
      {flash.done === 'confirmed' && <p className="ok">Payment confirmed.</p>}
      {flash.done === 'disputed' && <p className="ok">Recorded. The buyer has been told.</p>}
      {flash.done === 'rated' && <p className="ok">Rating submitted.</p>}

      <p>
        You are the <strong>{isBuyer ? 'buyer' : 'seller'}</strong>. Counterparty:{' '}
        <Link href={`/members/${counterpartyId}`}>{counterparty?.name ?? 'member'}</Link>
      </p>

      {/* ---------------------------------------------- the two tracks */}
      <h2>Progress</h2>
      <table>
        <tbody>
          <tr>
            <td>Payment</td>
            <td>{PAYMENT_LABELS[t.paymentState]}</td>
          </tr>
          {usesCustodyTrack(t.fulfillmentPath) && (
            <tr>
              <td>Custody</td>
              <td>
                {t.custodyState.replace(/_/g, ' ')}{' '}
                <span className="muted">— the store flow lands in Phase 2</span>
              </td>
            </tr>
          )}
          <tr>
            <td>Payment due</td>
            <td>
              {t.paymentDeadlineAt.toLocaleString('en-TT')}
              {isOpen && t.paymentState === 'pending' && (
                <span className="muted"> — after this it goes to the next buyer</span>
              )}
            </td>
          </tr>
          {t.sellerDropoffDeadlineAt !== null && (
            <tr>
              <td>Seller must deliver by</td>
              <td>{t.sellerDropoffDeadlineAt.toLocaleString('en-TT')}</td>
            </tr>
          )}
        </tbody>
      </table>

      <p className="muted">
        Pay the {isBuyer ? 'seller' : 'buyer'} directly — cash, bank transfer, however you
        agreed. CollectTT never handles the money; it only records what both of you say
        happened.
      </p>

      {/* ---------------------------------------------- the handshake */}
      {isOpen && (
        <>
          <h2>Your move</h2>

          {isBuyer && t.paymentState === 'pending' && (
            <form action={markPaidAction}>
              <input type="hidden" name="transactionId" value={id} />
              <p className="muted" style={{ marginTop: 0 }}>
                Once you&apos;ve paid {counterparty?.name ?? 'the seller'}
                {t.fulfillmentPath === 'cash_meetup' && ' (or met up and handed over cash)'},
                mark it here. They then confirm they received it.
              </p>
              <button type="submit">I&apos;ve paid</button>
            </form>
          )}

          {isBuyer && t.paymentState === 'buyer_marked_paid' && (
            <p className="muted">
              Waiting for {counterparty?.name ?? 'the seller'} to confirm they received it.
            </p>
          )}

          {isSeller && t.paymentState === 'pending' && (
            <p className="muted">
              Waiting for the buyer to pay. If the deadline passes, this is recorded against
              them and the item goes to the next person in the queue automatically.
            </p>
          )}

          {isSeller && t.paymentState === 'buyer_marked_paid' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                The buyer says they&apos;ve paid. Confirm only if the money actually arrived.
              </p>
              <div className="row">
                <form action={confirmPaymentAction}>
                  <input type="hidden" name="transactionId" value={id} />
                  <button type="submit">Yes, I received it</button>
                </form>
                <form action={disputePaymentAction}>
                  <input type="hidden" name="transactionId" value={id} />
                  <button className="secondary" type="submit">
                    No, nothing arrived
                  </button>
                </form>
              </div>
              <p className="muted">
                Saying no puts the deal back to awaiting payment. It does <em>not</em> extend
                the buyer&apos;s deadline.
              </p>
            </>
          )}
        </>
      )}

      {/* ---------------------------------------------- blind ratings */}
      {t.state === 'completed' && ratings !== null && (
        <>
          <h2>Rate this deal</h2>
          {ratings.mine === null ? (
            <form action={rateAction}>
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
              <p className="muted">
                Blind: neither of you sees the other&apos;s rating until you&apos;ve both
                submitted, or the window closes on{' '}
                {t.ratingWindowEndsAt?.toLocaleDateString('en-TT') ?? 'the deadline'}.
              </p>
              <button type="submit">Submit rating</button>
            </form>
          ) : (
            <p>
              You rated this {'★'.repeat(ratings.mine.stars)}
              {'☆'.repeat(5 - ratings.mine.stars)}.
            </p>
          )}

          {ratings.theirs !== null ? (
            <p>
              They rated you {'★'.repeat(ratings.theirs.stars)}
              {'☆'.repeat(5 - ratings.theirs.stars)}
              {ratings.theirs.comment !== null && <> — “{ratings.theirs.comment}”</>}
            </p>
          ) : ratings.theirsPending ? (
            <p className="muted">
              They have rated you, but it stays hidden until you submit yours.
            </p>
          ) : (
            <p className="muted">They haven&apos;t rated yet.</p>
          )}
        </>
      )}

      {/* ---------------------------------------------- audit trail */}
      <h2>History</h2>
      <table>
        <tbody>
          {timeline.map((event) => (
            <tr key={event.id}>
              <td className="muted">{event.occurredAt.toLocaleString('en-TT')}</td>
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
    </main>
  );
}
