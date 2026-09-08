import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Activity, CircleAlert, CircleCheck, HandCoins, UserRound } from 'lucide-react';

import { db } from '@/db/client';
import { currentUser } from '@/lib/session';
import { formatMoney } from '@/domain/money';
import { SETTLEMENT_METHOD_LABELS } from '@/domain/policy/settlement';
import { activeDealsForUser, type ActiveDealSummary } from '@/services/deals';
import { pendingOffersReceivedBySeller } from '@/services/offers';
import { acceptReceivedOfferAction, rejectReceivedOfferAction } from './actions';
import { trustSnapshotsForMembers, type TrustSnapshot } from '@/services/reputation';
import { BuyerSnapshotLink, type BuyerSnapshotData } from './buyer-snapshot-link';
import { ActiveDealsList, type ActiveDealFilter, type PhysicalDealFilter } from './active-deals-list';

export const dynamic = 'force-dynamic';

const DELIVERY_LABELS: Record<string, string> = {
  cash_meetup: 'Meet in person',
  remote_ship: 'Seller ships to buyer',
  relay: 'Store pickup',
  full_service: 'CollectTT delivery',
};

function serializeTrustSnapshot(snapshot: TrustSnapshot): BuyerSnapshotData {
  return {
    userId: snapshot.userId,
    displayName: snapshot.displayName,
    handle: snapshot.handle,
    area: snapshot.area,
    memberSince: snapshot.memberSince.toISOString(),
    counters: snapshot.counters,
    events: snapshot.events.map((event) => ({
      id: event.id,
      type: event.type,
      title: event.title,
      occurredAt: event.occurredAt.toISOString(),
    })),
  };
}

function formatReceivedAt(value: Date): { date: string; time: string } {
  return {
    date: value.toLocaleDateString('en-TT'),
    time: value.toLocaleTimeString('en-TT', { hour: 'numeric', minute: '2-digit' }),
  };
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; offer?: string; filter?: string; task?: string; view?: string }>;
}) {
  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in');

  const params = await searchParams;
  const [activeDeals, receivedOffers] = await Promise.all([
    activeDealsForUser(db, viewer.userId),
    pendingOffersReceivedBySeller(viewer.userId),
  ]);
  const buyerSnapshots = await trustSnapshotsForMembers(
    db,
    receivedOffers.map((offer) => offer.buyerId),
  );

  const attention = activeDeals.filter((deal) => deal.needsAttention);
  const isPhysicalView = params.view === 'collect';
  const initialFilter: ActiveDealFilter = params.filter === 'buying' || params.filter === 'selling' ? params.filter : 'all';
  const initialTask: PhysicalDealFilter = params.task === 'to_drop_off' || params.task === 'to_collect' || params.task === 'at_store' ? params.task : 'all';
  const visibleSectionCount = isPhysicalView
    ? activeDeals.filter((deal) => deal.physicalTask !== null).length
    : activeDeals.length;

  return (
    <main className="deals-page">
      <header className="deals-page__header">
        <div>
          <h1>My Deals</h1>
          <div className="deals-page__header-subtext">
            <p>Review new offers and handle the deals waiting on you.</p>
            <span className="deals-page__hint">Buyer names open a trust snapshot.</span>
          </div>
        </div>
      </header>

      {typeof params.error === 'string' && <div className="alert alert--error" role="alert">{params.error}</div>}
      {params.offer === 'rejected' && <div className="alert alert--info" role="status">Offer rejected.</div>}

      <section className="deals-inbox-section" aria-labelledby="attention-title">
        <div className="deals-inbox-section__heading">
          <div className="deals-inbox-section__icon deals-inbox-section__icon--attention" aria-hidden="true"><CircleAlert /></div>
          <div><h2 id="attention-title">Needs attention</h2><p>Only deals where it is currently your turn are shown here.</p></div>
          <span className="deals-inbox-section__count deals-inbox-section__count--attention">{attention.length}</span>
        </div>
        {attention.length === 0 ? (
          <p className="deals-inbox-empty deals-inbox-empty--success">
            <CircleCheck aria-hidden="true" />
            <strong>You are all caught up.</strong>
          </p>
        ) : (
          <div className="table-wrap">
            <table className="deals-inbox-table">
              <thead><tr><th>Listing</th><th>Your role</th><th>Amount</th><th>Next step</th><th>Due</th></tr></thead>
              <tbody>
                {attention.map((deal: ActiveDealSummary) => {
                  const isBuyer = deal.role === 'buying';
                  return (
                    <tr key={deal.id}>
                      <td><Link href={`/deals/${deal.id}`}>{deal.title}</Link></td>
                      <td>{isBuyer ? 'Buyer' : 'Seller'}</td>
                      <td className="num"><strong>{formatMoney(deal.amountCents)}</strong></td>
                      <td><strong>{deal.nextStep}</strong></td>
                      <td>{new Date(deal.deadlineAt).toLocaleString('en-TT')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="deals-inbox-section deals-inbox-section--active" aria-labelledby="active-deals-title">
        <div className="deals-inbox-section__heading">
          <div className="deals-inbox-section__icon deals-inbox-section__icon--active" aria-hidden="true"><Activity /></div>
          <div>
            <h2 id="active-deals-title">{isPhysicalView ? 'Collect / Drop-Off' : 'In action'}</h2>
            <p>{isPhysicalView ? 'The physical hand-offs you need to complete, using the same active deals.' : 'Every accepted deal moving through payment or fulfilment.'}</p>
          </div>
          <span className="deals-inbox-section__count deals-inbox-section__count--active">{visibleSectionCount}</span>
        </div>
        <nav className="deals-view-switcher" aria-label="Deal views">
          <Link className={!isPhysicalView ? 'is-active' : ''} href={`/deals${initialFilter === 'all' ? '' : `?filter=${initialFilter}`}`} aria-current={!isPhysicalView ? 'page' : undefined}>All active deals</Link>
          <Link className={isPhysicalView ? 'is-active' : ''} href="/deals?view=collect" aria-current={isPhysicalView ? 'page' : undefined}>Collect / Drop-Off</Link>
        </nav>
        <ActiveDealsList
          deals={activeDeals}
          mode={isPhysicalView ? 'physical' : 'all'}
          initialFilter={initialFilter}
          initialTask={initialTask}
        />
      </section>

      <section className="deals-inbox-section" aria-labelledby="received-offers-title">
        <div className="deals-inbox-section__heading">
          <div className="deals-inbox-section__icon" aria-hidden="true"><HandCoins /></div>
          <div><h2 id="received-offers-title">Offers received</h2><p>Accept an offer to open a deal, or reject it to let the buyer know.</p></div>
          <span className="deals-inbox-section__count deals-inbox-section__count--pending">{receivedOffers.length}</span>
        </div>
        {receivedOffers.length === 0 ? (
          <p className="deals-inbox-empty">No offers need a response.</p>
        ) : (
          <div className="table-wrap">
            <table className="deals-inbox-table">
              <thead>
                <tr><th>Listing</th><th>Buyer</th><th>Offer</th><th>Terms</th><th>Received</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {receivedOffers.map((offer) => {
                  const snapshot = buyerSnapshots.get(offer.buyerId);
                  const receivedAt = formatReceivedAt(offer.createdAt);
                  const offerLocked = offer.listingStatus !== 'active' || offer.activeTransactionId !== null;
                  return (
                    <tr key={offer.id}>
                      <td><Link href={`/listings/${offer.listingId}`}>{offer.listingTitle}</Link></td>
                      <td>
                        {snapshot === undefined ? (
                          <span className="deals-inbox-table__buyer-fallback"><UserRound aria-hidden="true" />{offer.buyerName}</span>
                        ) : (
                          <BuyerSnapshotLink snapshot={serializeTrustSnapshot(snapshot)} />
                        )}
                      </td>
                      <td className="num"><strong>{formatMoney(offer.amountCents)}</strong></td>
                      <td>
                        <span>{DELIVERY_LABELS[offer.fulfillmentPath] ?? offer.fulfillmentPath}</span>
                        {offer.fulfillmentPath === 'relay' && (
                          <small>{offer.relayStoreName === null ? 'Store not recorded' : `${offer.relayStoreName}${offer.relayStoreArea ? ` · ${offer.relayStoreArea}` : ''}`}</small>
                        )}
                        <small>{offer.settlementMethod === null ? 'Payment method not recorded' : SETTLEMENT_METHOD_LABELS[offer.settlementMethod as keyof typeof SETTLEMENT_METHOD_LABELS] ?? offer.settlementMethod}</small>
                      </td>
                      <td className="deals-inbox-table__received">
                        <span>{receivedAt.date}</span>
                        <small>{receivedAt.time}</small>
                      </td>
                      <td>
                        <div className="offer-actions">
                          <form action={acceptReceivedOfferAction}>
                            <input type="hidden" name="listingId" value={offer.listingId} />
                            <input type="hidden" name="offerId" value={offer.id} />
                            <button
                              className="offer-action offer-action--accept"
                              type="submit"
                              disabled={offerLocked}
                              aria-label={offerLocked ? 'Accept unavailable while another deal is in progress' : 'Accept offer'}
                            >
                              {offerLocked ? 'In progress' : 'Accept'}
                            </button>
                          </form>
                          <form action={rejectReceivedOfferAction}>
                            <input type="hidden" name="listingId" value={offer.listingId} />
                            <input type="hidden" name="offerId" value={offer.id} />
                            <button className="secondary offer-action offer-action--reject" type="submit">Reject</button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
