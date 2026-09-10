import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, CircleCheck, Clock3, HandCoins, UserRound } from 'lucide-react';

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
import { listMarketplaceOptions } from '@/services/platform-settings';

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

type DealsTab = 'attention' | 'active' | 'offers' | 'handoffs';

function formatDealDeadline(value: string): string {
  return new Date(value).toLocaleDateString('en-TT', {
    timeZone: 'America/Port_of_Spain',
    day: 'numeric',
    month: 'short',
  });
}

function attentionSummary(count: number): string {
  if (count === 0) return 'Nothing needs you right now.';
  if (count === 1) return 'One deal needs you today.';
  if (count === 2) return 'Two deals need you today.';
  return `${count} deals need you today.`;
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; offer?: string; filter?: string; tab?: string; task?: string; view?: string }>;
}) {
  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in');

  const params = await searchParams;
  const [activeDeals, receivedOffers, deliveryOptions, paymentOptions] = await Promise.all([
    activeDealsForUser(db, viewer.userId),
    pendingOffersReceivedBySeller(viewer.userId),
    listMarketplaceOptions('delivery'),
    listMarketplaceOptions('payment'),
  ]);
  const deliveryOptionById = new Map(deliveryOptions.map((option) => [option.id, option]));
  const paymentOptionByKey = new Map(paymentOptions.map((option) => [option.key, option]));
  const buyerSnapshots = await trustSnapshotsForMembers(
    db,
    receivedOffers.map((offer) => offer.buyerId),
  );

  const attention = activeDeals.filter((deal) => deal.needsAttention);
  const initialFilter: ActiveDealFilter = params.filter === 'buying' || params.filter === 'selling' ? params.filter : 'all';
  const initialTask: PhysicalDealFilter = params.task === 'to_drop_off' || params.task === 'to_collect' || params.task === 'at_store' ? params.task : 'all';
  const handoffs = activeDeals.filter((deal) => deal.physicalTask !== null);
  const selectedTab: DealsTab = params.view === 'collect' || typeof params.task === 'string'
    ? 'handoffs'
    : typeof params.filter === 'string'
      ? 'active'
      : params.tab === 'active' || params.tab === 'offers' || params.tab === 'handoffs'
        ? params.tab
        : 'attention';

  const tabs: Array<{ id: DealsTab; label: string; count: number; href: string }> = [
    { id: 'attention', label: 'Needs attention', count: attention.length, href: '/deals' },
    { id: 'active', label: 'Active', count: activeDeals.length, href: '/deals?tab=active' },
    { id: 'offers', label: 'Offers', count: receivedOffers.length, href: '/deals?tab=offers' },
    { id: 'handoffs', label: 'Pickups & drop-offs', count: handoffs.length, href: '/deals?tab=handoffs' },
  ];

  return (
    <main className="deals-page">
      <header className="deals-page__header">
        <div>
          <h1>My Deals</h1>
          <p className="deals-page__summary">{attentionSummary(attention.length)}</p>
        </div>
      </header>

      {typeof params.error === 'string' && <div className="alert alert--error" role="alert">{params.error}</div>}
      {params.offer === 'rejected' && <div className="alert alert--info" role="status">Offer rejected.</div>}

      <nav className="deals-tabs" aria-label="Deal inbox">
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            className={selectedTab === tab.id ? 'is-active' : ''}
            href={tab.href}
            scroll={false}
            aria-current={selectedTab === tab.id ? 'page' : undefined}
          >
            <span>{tab.label}</span>
            <strong aria-label={`${tab.count} ${tab.label.toLowerCase()}`}>{tab.count}</strong>
          </Link>
        ))}
      </nav>

      {selectedTab === 'attention' && (
        <section className="attention-inbox" aria-labelledby="attention-title">
          <h2 className="sr-only" id="attention-title">Needs attention</h2>
          {attention.length === 0 ? (
            <div className="attention-inbox__empty">
              <span aria-hidden="true"><CircleCheck /></span>
              <strong>You are all caught up.</strong>
              <p>Nothing else needs you right now.</p>
            </div>
          ) : (
            <ol className="attention-inbox__list">
              {attention.map((deal: ActiveDealSummary) => (
                <li key={deal.id}>
                  <article className="attention-deal">
                    <div className="attention-deal__topline">
                      <div>
                        <Link className="attention-deal__title" href={`/deals/${deal.id}`}>{deal.title}</Link>
                        <span className={`attention-deal__role attention-deal__role--${deal.role}`}>
                          {deal.role === 'buying' ? 'Buying' : 'Selling'}
                        </span>
                      </div>
                      <div className="attention-deal__due">
                        <Clock3 aria-hidden="true" />
                        <span>Due</span>
                        <time dateTime={deal.deadlineAt}>{formatDealDeadline(deal.deadlineAt)}</time>
                      </div>
                    </div>
                    <div className="attention-deal__body">
                      <strong className="attention-deal__amount num">{formatMoney(deal.amountCents)}</strong>
                      <div className="attention-deal__step">
                        <span>Next step</span>
                        <strong>{deal.nextStep}</strong>
                      </div>
                      <ChevronRight aria-hidden="true" />
                    </div>
                    <Link className="attention-deal__action button" href={`/deals/${deal.id}`}>
                      Open deal
                    </Link>
                  </article>
                </li>
              ))}
            </ol>
          )}

          {attention.length > 0 && (
            <div className="attention-inbox__complete">
              <span aria-hidden="true"><CircleCheck /></span>
              <strong>Nothing else needs you right now.</strong>
              <p>We’ll let you know when something does.</p>
            </div>
          )}

          <Link className="attention-inbox__all-link" href="/deals?tab=active" scroll={false}>
            View all active deals <ChevronRight aria-hidden="true" />
          </Link>
        </section>
      )}

      {selectedTab === 'active' && (
        <section className="deals-tab-panel" aria-labelledby="active-deals-title">
          <div className="deals-tab-panel__heading">
            <div><h2 id="active-deals-title">Active deals</h2><p>Every accepted deal moving through payment or fulfilment.</p></div>
            <span>{activeDeals.length}</span>
          </div>
          <ActiveDealsList deals={activeDeals} mode="all" initialFilter={initialFilter} />
        </section>
      )}

      {selectedTab === 'handoffs' && (
        <section className="deals-tab-panel" aria-labelledby="handoffs-title">
          <div className="deals-tab-panel__heading">
            <div><h2 id="handoffs-title">Pickups &amp; drop-offs</h2><p>Physical hand-offs that are ready for you or waiting at a store.</p></div>
            <span>{handoffs.length}</span>
          </div>
          <ActiveDealsList deals={activeDeals} mode="physical" initialTask={initialTask} />
        </section>
      )}

      {selectedTab === 'offers' && (
        <section className="deals-tab-panel" aria-labelledby="received-offers-title">
          <div className="deals-tab-panel__heading">
            <div>
              <h2 id="received-offers-title"><HandCoins aria-hidden="true" />Offers received</h2>
              <p>Accept an offer to open a deal, or reject it to let the buyer know.</p>
              <span className="deals-tab-panel__hint">Buyer names open a trust snapshot.</span>
            </div>
            <span>{receivedOffers.length}</span>
          </div>
        {receivedOffers.length === 0 ? (
          <p className="deals-inbox-empty">No offers need a response.</p>
        ) : (
          <ol className="offers-inbox__list">
            {receivedOffers.map((offer) => {
              const snapshot = buyerSnapshots.get(offer.buyerId);
              const receivedAt = formatReceivedAt(offer.createdAt);
              const offerLocked = offer.listingStatus !== 'active' || offer.activeTransactionId !== null;
              const deliveryOption = offer.deliveryOptionId === null ? undefined : deliveryOptionById.get(offer.deliveryOptionId);
              const paymentOption = offer.settlementMethod === null ? undefined : paymentOptionByKey.get(offer.settlementMethod);
              return (
                <li key={offer.id}>
                  <article className="offer-inbox-card">
                    <div className="offer-inbox-card__header">
                      <div>
                        <span className="offer-inbox-card__eyebrow">Offer for</span>
                        <Link href={`/listings/${offer.listingId}`}>{offer.listingTitle}</Link>
                      </div>
                      <strong className="num">{formatMoney(offer.amountCents)}</strong>
                    </div>
                    <dl className="offer-inbox-card__facts">
                      <div>
                        <dt>Buyer</dt>
                        <dd>
                          {snapshot === undefined ? (
                            <span className="deals-inbox-table__buyer-fallback"><UserRound aria-hidden="true" />{offer.buyerName}</span>
                          ) : (
                            <BuyerSnapshotLink snapshot={serializeTrustSnapshot(snapshot)} />
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Delivery</dt>
                        <dd>
                          {deliveryOption?.label ?? DELIVERY_LABELS[offer.fulfillmentPath] ?? offer.fulfillmentPath}
                          {(deliveryOption?.requiresStore === true || offer.fulfillmentPath === 'relay') && (
                            <small>{offer.relayStoreName === null ? 'Store not recorded' : `${offer.relayStoreName}${offer.relayStoreArea ? ` · ${offer.relayStoreArea}` : ''}`}</small>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Payment</dt>
                        <dd>{offer.settlementMethod === null ? 'Not recorded' : paymentOption?.label ?? SETTLEMENT_METHOD_LABELS[offer.settlementMethod] ?? offer.settlementMethod}</dd>
                      </div>
                      <div>
                        <dt>Received</dt>
                        <dd><time dateTime={offer.createdAt.toISOString()}>{receivedAt.date} · {receivedAt.time}</time></dd>
                      </div>
                    </dl>
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
                  </article>
                </li>
              );
            })}
          </ol>
        )}
        </section>
      )}
    </main>
  );
}
