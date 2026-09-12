'use client';

import { type FC, type ReactNode, useEffect, useState } from 'react';
import type { Key } from 'react-aria-components';
import Link from 'next/link';
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  Gavel,
  HandCoins,
  HeartHandshake,
  ListTodo,
  LogOut,
  Pencil,
  ShoppingBag,
  Trash2,
  WalletCards,
} from 'lucide-react';

import { Tabs } from '@/components/application/tabs/tabs';
import { NativeSelect } from '@/components/base/select/select-native';
import { normalizeProfileTab, profileTabs } from '@/lib/profile-tabs';

type CounterData = {
  buyClaimsTotal: number;
  buyCompleted: number;
  buyRenegedTotal: number;
  buyPaidOnTime: number;
  sellCompleted: number;
  sellRenegedTotal: number;
};

type ListingData = {
  id: string;
  title: string;
  category: string;
  saleType: string;
  status: string;
  claimCount: number;
  bidCount: number;
  activeTransactionCount: number;
  amount: string;
};
type ClaimData = { id: string; title: string; status: string; transactionId: string | null; fulfillmentPath: string; claimedAt: string };
type BidData = { id: string; title: string; amount: string; status: string; placedAt: string };
type OfferData = { id: string; title: string; amount: string; status: string; createdAt: string };
type DealData = { id: string; title: string; role: string; amount: string; state: string; fulfillmentPath: string; createdAt: string; completedAt: string | null };
type ReputationEventData = { id: string; type: string; title: string | null; occurredAt: string; transactionId: string | null; amount: string | null; role: string | null };

interface ProfilePageProps {
  signOutAction: () => Promise<void>;
  deleteListingAction: (formData: FormData) => Promise<void>;
  initialTab?: string;
  counters: CounterData | null;
  listings: ListingData[];
  claims: ClaimData[];
  bids: BidData[];
  offers: OfferData[];
  deals: DealData[];
  reputationEvents: ReputationEventData[];
}

const date = (value: string) => new Date(value).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const fulfillmentLabel = (value: string) => ({ cash_meetup: 'Meet in person', remote_ship: 'Seller ships to you', relay: 'Pick up at a store', full_service: 'CollectTT delivery' })[value] ?? titleCase(value);
const reputationEventLabel = (value: string) => ({
  purchase_completed: 'Purchase completed',
  sale_completed: 'Sale completed',
  buyer_paid_on_time: 'Payment made on time',
  buyer_paid_late: 'Payment made late',
  buyer_reneged_nonpayment: 'Buyer did not pay',
  buyer_no_show: 'Buyer no-show',
  seller_delivered_on_time: 'Delivery completed on time',
  seller_reneged_no_dropoff: 'Seller did not drop off',
  seller_no_show: 'Seller no-show',
  custody_overstay: 'Collection window overstay',
  admin_adjustment: 'Account adjustment',
})[value] ?? titleCase(value);

const EmptyState: FC<{ icon: ReactNode; title: string; children: ReactNode }> = ({ icon, title, children }) => (
  <div className="profile-empty">
    <div className="profile-empty__icon" aria-hidden="true">{icon}</div>
    <h3>{title}</h3>
    <p>{children}</p>
  </div>
);

const StatusPill: FC<{ value: string }> = ({ value }) => (
  <span className={`profile-status profile-status--${value}`}>{titleCase(value)}</span>
);

function TrustPanel({ counters, reputationEvents }: Pick<ProfilePageProps, 'counters' | 'reputationEvents'>) {
  const completedDeals = (counters?.buyCompleted ?? 0) + (counters?.sellCompleted ?? 0);
  const paidOnTime = `${counters?.buyPaidOnTime ?? 0} / ${counters?.buyClaimsTotal ?? 0}`;

  return (
    <div className="profile-content-stack">
      <section className="profile-panel profile-panel--trust">
        <div className="profile-panel__title"><h3>Your trust snapshot</h3><span>Verified activity</span></div>
        <div className="trust-summary">
          <div className="trust-summary__primary"><strong>{completedDeals}</strong><span>Completed deals</span></div>
          <div className="trust-summary__metric trust-summary__metric--blue"><strong>{counters?.buyCompleted ?? 0}</strong><span>Purchases</span></div>
          <div className="trust-summary__metric trust-summary__metric--purple"><strong>{counters?.sellCompleted ?? 0}</strong><span>Sales</span></div>
          <div className="trust-summary__metric trust-summary__metric--green"><strong>{paidOnTime}</strong><span>Paid on time / purchases</span></div>
        </div>
        <p className="profile-panel__note">Built from verified transaction outcomes and used for account protections.</p>
      </section>
      <section className="profile-panel profile-panel--activity">
        <div className="profile-section-heading profile-section-heading--tight">
          <div><h3 className="profile-section-heading__title">Activity that builds trust</h3><p className="profile-section-heading__description">These verified outcomes contribute to the snapshot above.</p></div>
          <span className="profile-section-heading__hint">{reputationEvents.length} recorded</span>
        </div>
        {reputationEvents.length === 0 ? (
          <EmptyState icon={<BadgeCheck size={22} />} title="No verified activity yet">Completed transactions and payment outcomes will appear here as they happen.</EmptyState>
        ) : (
          <div className="profile-trust-activity">
            {reputationEvents.map((event) => (
              <article className="profile-trust-activity__row" key={event.id}>
                <div className="profile-trust-activity__icon" aria-hidden="true"><BadgeCheck size={18} /></div>
                <div className="profile-trust-activity__main">
                  <strong>{reputationEventLabel(event.type)}</strong>
                  <span>
                    {event.transactionId !== null ? <Link href={`/deals/${event.transactionId}`}>{event.title ?? 'CollectTT transaction'}</Link> : (event.title ?? 'CollectTT transaction')}
                    {event.role !== null && ` · ${event.role}`}
                    {event.amount !== null && ` · ${event.amount}`}
                    {` · ${date(event.occurredAt)}`}
                  </span>
                </div>
                <span className="profile-trust-activity__type">Verified</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type ActivityItem = {
  id: string;
  kind: 'claim' | 'bid' | 'offer' | 'deal';
  title: string;
  detail: string;
  occurredAt: string;
  status: string;
  href?: string;
};

function ActivityIcon({ kind }: { kind: ActivityItem['kind'] }) {
  if (kind === 'claim') return <ShoppingBag size={18} aria-hidden="true" />;
  if (kind === 'bid') return <Gavel size={18} aria-hidden="true" />;
  if (kind === 'offer') return <HandCoins size={18} aria-hidden="true" />;
  return <HeartHandshake size={18} aria-hidden="true" />;
}

function ActivityPanel({ claims, bids, offers, deals }: Pick<ProfilePageProps, 'claims' | 'bids' | 'offers' | 'deals'>) {
  const activity = [
    ...claims.map<ActivityItem>((claim) => ({
      id: `claim-${claim.id}`,
      kind: 'claim',
      title: claim.title,
      detail: `${fulfillmentLabel(claim.fulfillmentPath)} · Claimed ${date(claim.claimedAt)}`,
      occurredAt: claim.claimedAt,
      status: claim.status,
      href: claim.transactionId === null ? undefined : `/deals/${claim.transactionId}`,
    })),
    ...bids.map<ActivityItem>((bid) => ({
      id: `bid-${bid.id}`,
      kind: 'bid',
      title: bid.title,
      detail: `Bid ${bid.amount} · Placed ${date(bid.placedAt)}`,
      occurredAt: bid.placedAt,
      status: bid.status,
    })),
    ...offers.map<ActivityItem>((offer) => ({
      id: `offer-${offer.id}`,
      kind: 'offer',
      title: offer.title,
      detail: `Offer ${offer.amount} · Sent ${date(offer.createdAt)}`,
      occurredAt: offer.createdAt,
      status: offer.status,
    })),
    ...deals.map<ActivityItem>((deal) => ({
      id: `deal-${deal.id}`,
      kind: 'deal',
      title: deal.title,
      detail: `${deal.role} · ${fulfillmentLabel(deal.fulfillmentPath)} · Started ${date(deal.createdAt)}`,
      occurredAt: deal.createdAt,
      status: deal.state,
      href: `/deals/${deal.id}`,
    })),
  ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return (
    <div className="profile-content-stack">
      <section className="profile-panel profile-panel--activity-overview">
        <div className="profile-section-heading profile-section-heading--tight">
          <div>
            <h3 className="profile-section-heading__title">Your activity</h3>
            <p className="profile-section-heading__description">A single timeline for claims, bids, offers, and transactions.</p>
          </div>
          <span className="profile-section-heading__hint">{activity.length} recorded</span>
        </div>
      </section>
      <section className="profile-history-list profile-activity-list" aria-labelledby="profile-activity-title">
        <div className="profile-section-heading profile-section-heading--tight">
          <h3 id="profile-activity-title">Recent activity</h3>
          {activity.length > 0 && <span className="profile-section-heading__hint">Newest first</span>}
        </div>
        {activity.length === 0 ? (
          <EmptyState icon={<WalletCards size={22} />} title="No activity yet">Your claims, bids, offers, and completed transactions will appear here.</EmptyState>
        ) : (
          <div className="profile-activity-feed">
            {activity.slice(0, 30).map((item) => (
              <article className="profile-activity-row" key={item.id}>
                <div className={`profile-activity-row__icon profile-activity-row__icon--${item.kind}`} aria-hidden="true"><ActivityIcon kind={item.kind} /></div>
                <div className="profile-activity-row__main">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <div className="profile-activity-row__aside">
                  <StatusPill value={item.status} />
                  {item.href !== undefined && <Link href={item.href}>Open deal →</Link>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function listingActionLockReason(listing: ListingData): string | null {
  if (listing.activeTransactionCount > 0) return 'Locked while a sale is in progress.';
  if (listing.saleType === 'auction' && listing.bidCount > 0) return 'Locked while active bids are on this auction.';
  if (listing.saleType === 'straight_sale' && listing.claimCount > 0) return 'Locked while active claims are on this listing.';
  if (listing.status !== 'active' && listing.status !== 'draft') return 'Unavailable for this listing status.';
  return null;
}

function ListingActions({ listing, deleteListingAction }: { listing: ListingData; deleteListingAction: ProfilePageProps['deleteListingAction'] }) {
  const actionLockReason = listingActionLockReason(listing);
  const actionsDisabled = actionLockReason !== null;
  return (
    <div className="profile-list-row__actions">
      <Link className="profile-action-button" href={`/listings/${listing.id}`} aria-label={`View ${listing.title}`} title="View listing">
        <Eye size={14} aria-hidden="true" />
      </Link>
      {actionsDisabled ? (
        <button className="profile-action-button" type="button" disabled aria-label={`Edit ${listing.title} unavailable. ${actionLockReason}`} title={actionLockReason}>
          <Pencil size={14} aria-hidden="true" />
        </button>
      ) : (
        <Link className="profile-action-button" href={`/listings/${listing.id}/edit`} aria-label={`Edit ${listing.title}`} title="Edit listing">
          <Pencil size={14} aria-hidden="true" />
        </Link>
      )}
      <form action={deleteListingAction} onSubmit={(event) => { if (!window.confirm('Delete this listing? It will no longer be available to buyers.')) event.preventDefault(); }}>
        <input type="hidden" name="listingId" value={listing.id} />
        <button className="profile-action-button profile-action-button--danger" type="submit" disabled={actionsDisabled} aria-label={actionsDisabled ? `Delete ${listing.title} unavailable. ${actionLockReason}` : `Delete ${listing.title}`} title={actionsDisabled ? actionLockReason : 'Delete listing'}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

type ListingTableProps = {
  listings: ListingData[];
  saleType: 'auction' | 'straight_sale';
  deleteListingAction: ProfilePageProps['deleteListingAction'];
};

function ListingsTable({ listings, saleType, deleteListingAction }: ListingTableProps) {
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(1);
  const isAuction = saleType === 'auction';
  const tableId = isAuction ? 'active-auctions' : 'active-straight-sales';
  const typeListings = listings.filter((listing) => listing.saleType === saleType);
  const activeListings = typeListings.filter((listing) => listing.status === 'active');
  const visibleListings = showInactive ? typeListings : activeListings;
  const pageCount = Math.max(1, Math.ceil(visibleListings.length / 5));
  const currentPage = Math.min(page, pageCount);
  const pageRows = visibleListings.slice((currentPage - 1) * 5, currentPage * 5);
  const title = isAuction ? 'Auction Listings' : 'Straight Sale Listings';
  const itemLabel = isAuction ? 'auction' : 'straight sale listing';

  const toggleInactive = (checked: boolean) => {
    setShowInactive(checked);
    setPage(1);
  };

  return (
    <section className="profile-listings-table-card" aria-labelledby={`${tableId}-title`}>
      <div className="profile-listings-table-card__header">
        <div>
          <div className="profile-listings-table-card__title">
            <span className={`profile-listings-table-card__icon ${isAuction ? 'profile-listings-table-card__icon--auction' : ''}`} aria-hidden="true">
              {isAuction ? <Gavel size={18} /> : <ListTodo size={18} />}
            </span>
            <h3 id={`${tableId}-title`}>{title}</h3>
          </div>
        </div>
        <div className="profile-listings-table-card__controls">
          <span className="profile-listings-table-card__count">{activeListings.length} active</span>
          <label className="profile-listings-toggle">
            <input type="checkbox" checked={showInactive} onChange={(event) => toggleInactive(event.target.checked)} />
            <span>Show inactive</span>
          </label>
        </div>
      </div>
      <div className="profile-listing-table-wrap">
        <table className="profile-listing-table">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Listing</th>
              <th scope="col">{isAuction ? 'Current bid' : 'Price'}</th>
              <th scope="col">{isAuction ? 'Active bids' : 'Active claims'}</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr className="profile-listing-table__empty-row">
                <td colSpan={4}>
                  <strong>{showInactive ? `No ${itemLabel}s yet` : `No active ${itemLabel}s`}</strong>
                  <span>{showInactive ? 'Create a listing to see it here.' : 'Inactive listings are hidden. Turn on “Show inactive” to see them.'}</span>
                </td>
              </tr>
            ) : pageRows.map((listing) => {
              const activeCount = isAuction ? listing.bidCount : listing.claimCount;
              const actionLockReason = listingActionLockReason(listing);
              return (
                <tr key={listing.id}>
                  <th scope="row" className="profile-listing-table__name">
                    <Link href={`/listings/${listing.id}`}>{listing.title}</Link>
                    {listing.status !== 'active' && <StatusPill value={listing.status} />}
                  </th>
                  <td className="profile-listing-table__amount">{listing.amount}</td>
                  <td className="profile-listing-table__metric">{activeCount}</td>
                  <td className="profile-listing-table__actions">
                    <ListingActions listing={listing} deleteListingAction={deleteListingAction} />
                    {actionLockReason !== null && <small>{actionLockReason}</small>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav className="profile-listing-pagination" aria-label={`${title} pagination`}>
        <span>Page {currentPage} of {pageCount}</span>
        <div>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label={`Previous ${itemLabel} page`}>
            <ChevronLeft size={16} aria-hidden="true" />
            <span>Previous</span>
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount} aria-label={`Next ${itemLabel} page`}>
            <span>Next</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </nav>
    </section>
  );
}

function ListingsPanel({ listings, deleteListingAction }: Pick<ProfilePageProps, 'listings' | 'deleteListingAction'>) {
  return (
    <div className="profile-content-stack">
      <ListingsTable listings={listings} saleType="auction" deleteListingAction={deleteListingAction} />
      <ListingsTable listings={listings} saleType="straight_sale" deleteListingAction={deleteListingAction} />
    </div>
  );
}

function BidsOffersPanel({ bids, offers }: Pick<ProfilePageProps, 'bids' | 'offers'>) {
  return (
    <div className="profile-content-stack">
      <section className="profile-panel profile-panel--bids-offers-intro">
        <div className="profile-section-heading profile-section-heading--tight">
          <div>
            <h3 className="profile-section-heading__title">Bids &amp; offers</h3>
            <p className="profile-section-heading__description">Keep every action you sent in one place. Seller responses and deal updates live in My Deals.</p>
          </div>
          <span className="profile-section-heading__hint">{bids.length + offers.length} sent</span>
        </div>
      </section>
      <div className="profile-two-column">
        <section className="profile-panel">
          <div className="profile-panel__title"><Gavel size={19} aria-hidden="true" /><h3>Auction bids <span>{bids.length}</span></h3></div>
          {bids.length === 0 ? <p className="profile-panel__empty-copy">Your auction bids will show up here.</p> : <div className="profile-mini-list">{bids.slice(0, 30).map((bid) => <div className="profile-mini-row" key={bid.id}><div><strong>{bid.title}</strong><small>Placed {date(bid.placedAt)}</small></div><div><strong>{bid.amount}</strong><StatusPill value={bid.status} /></div></div>)}</div>}
        </section>
        <section className="profile-panel">
          <div className="profile-panel__title"><HandCoins size={19} aria-hidden="true" /><h3>Offers sent <span>{offers.length}</span></h3></div>
          {offers.length === 0 ? <p className="profile-panel__empty-copy">Offers you make on fixed-price listings will show up here.</p> : <div className="profile-mini-list">{offers.slice(0, 30).map((offer) => <div className="profile-mini-row" key={offer.id}><div><strong>{offer.title}</strong><small>Sent {date(offer.createdAt)}</small></div><div><strong>{offer.amount}</strong><StatusPill value={offer.status} /></div></div>)}</div>}
        </section>
      </div>
    </div>
  );
}

const panelByTab: Record<string, FC<ProfilePageProps>> = {
  activity: ({ claims, bids, offers, deals }) => <ActivityPanel claims={claims} bids={bids} offers={offers} deals={deals} />,
  trust: ({ counters, reputationEvents }) => <TrustPanel counters={counters} reputationEvents={reputationEvents} />,
  listings: ({ listings, deleteListingAction }) => <ListingsPanel listings={listings} deleteListingAction={deleteListingAction} />,
  'bids-offers': ({ bids, offers }) => <BidsOffersPanel bids={bids} offers={offers} />,
};

export default function ProfilePage(props: ProfilePageProps) {
  const initialTab = normalizeProfileTab(props.initialTab);
  const [selectedTabIndex, setSelectedTabIndex] = useState<Key>(initialTab);
  useEffect(() => {
    setSelectedTabIndex(initialTab);
  }, [initialTab]);
  const ActivePanel = panelByTab[String(selectedTabIndex)] ?? panelByTab.activity!;
  const selectedTab = profileTabs.find((tab) => tab.id === String(selectedTabIndex)) ?? profileTabs[0];

  return <>
    <div className="profile-page__section-bar">
      <Link className="profile-page__back" href="/listings">← Back to browse</Link>
      <div className="profile-section-heading">
        <h2>{selectedTab.label}</h2>
      </div>
    </div>
    <div className="profile-workspace">
      <div className="profile-navigation">
        <NativeSelect size="sm" aria-label="Profile sections" value={String(selectedTabIndex)} onChange={(event) => setSelectedTabIndex(event.target.value)} options={profileTabs.map((tab) => ({ label: tab.label, value: tab.id }))} className="profile-navigation__mobile" />
        <Tabs orientation="vertical" selectedKey={selectedTabIndex} onSelectionChange={setSelectedTabIndex} className="profile-navigation__desktop">
          <Tabs.List type="button-brand" items={profileTabs}>{(tab) => <Tabs.Item {...tab} />}</Tabs.List>
        </Tabs>
        <form className="profile-navigation__signout" action={props.signOutAction}>
          <button type="submit"><LogOut size={17} aria-hidden="true" /> Sign out</button>
        </form>
      </div>
      <div className="profile-tab-panel" role="tabpanel" aria-label={profileTabs.find((tab) => tab.id === String(selectedTabIndex))?.label}><ActivePanel {...props} /></div>
    </div>
  </>;
}
