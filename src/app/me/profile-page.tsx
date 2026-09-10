'use client';

import { type FC, type ReactNode, useState } from 'react';
import type { Key } from 'react-aria-components';
import Link from 'next/link';
import {
  BadgeCheck,
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  Gavel,
  HandCoins,
  HeartHandshake,
  ListTodo,
  LogOut,
  Pencil,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  WalletCards,
} from 'lucide-react';

import { Tabs } from '@/components/application/tabs/tabs';
import { NativeSelect } from '@/components/base/select/select-native';

const tabs = [
  { id: 'details', label: 'My Details' },
  { id: 'trust', label: 'Trust & Activity' },
  { id: 'listings', label: 'My Listings' },
  { id: 'claims', label: 'Claims' },
  { id: 'bids-offers', label: 'Bids / Offers' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
] as const;

type ProfileData = {
  displayName: string;
  handle: string;
  email: string;
  image: string | null;
  phoneE164: string | null;
  bio: string | null;
  area: string | null;
  deliveryAddressLine1: string | null;
  deliveryAddressLine2: string | null;
  deliveryCity: string | null;
  deliveryCountry: string;
  memberSince: string;
};

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
type ReceivedOfferData = OfferData & { buyerName: string };
type DealData = { id: string; title: string; role: string; amount: string; state: string; fulfillmentPath: string; createdAt: string; completedAt: string | null };
type ReputationEventData = { id: string; type: string; title: string | null; occurredAt: string };

interface ProfilePageProps {
  signOutAction: () => Promise<void>;
  deleteListingAction: (formData: FormData) => Promise<void>;
  profile: ProfileData;
  counters: CounterData | null;
  listings: ListingData[];
  claims: ClaimData[];
  bids: BidData[];
  offers: OfferData[];
  receivedOffers: ReceivedOfferData[];
  deals: DealData[];
  reputationEvents: ReputationEventData[];
  objectiveLines: string[];
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

const DetailRow: FC<{ label: string; value: ReactNode }> = ({ label, value }) => (
  <div className="profile-detail-row">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

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

function DetailsPanel({ profile }: Pick<ProfilePageProps, 'profile'>) {
  return (
    <div className="profile-content-stack">
      <section className="profile-panel profile-panel--details">
        <div className="profile-contact-grid">
          <DetailRow label="Display name" value={profile.displayName} />
          <DetailRow label="Email address" value={profile.email} />
          <DetailRow label="Phone number" value={profile.phoneE164 ?? 'Add your phone number'} />
          <DetailRow label="Member since" value={new Date(profile.memberSince).toLocaleDateString('en-TT', { month: 'long', year: 'numeric' })} />
        </div>
        <div className="profile-address-block">
          <div className="profile-address-block__title"><strong>Delivery address</strong><span>Used for deliveries and collections.</span></div>
          <div className="profile-address-fields">
            <DetailRow label="Address line 1" value={profile.deliveryAddressLine1 ?? 'Add address line 1'} />
            <DetailRow label="Address line 2" value={profile.deliveryAddressLine2 ?? 'Add address line 2'} />
            <DetailRow label="City" value={profile.deliveryCity ?? 'Add your city'} />
            <DetailRow label="Country" value={profile.deliveryCountry} />
          </div>
          <p className="profile-address-block__note">This app is only for use within Trinidad and Tobago and does not apply elsewhere.</p>
        </div>
      </section>
    </div>
  );
}

function TrustPanel({ counters, reputationEvents }: Pick<ProfilePageProps, 'counters' | 'reputationEvents'>) {
  const completedDeals = (counters?.buyCompleted ?? 0) + (counters?.sellCompleted ?? 0);
  const paidOnTime = counters?.buyClaimsTotal
    ? `${counters.buyPaidOnTime} of ${counters.buyClaimsTotal}`
    : 'No purchase history';

  return (
    <div className="profile-content-stack">
      <section className="profile-panel profile-panel--trust">
        <div className="profile-panel__title"><h3>Your trust snapshot</h3><span>Verified activity</span></div>
        <div className="trust-summary">
          <div className="trust-summary__primary"><strong>{completedDeals}</strong><span>Completed deals</span></div>
          <div className="trust-summary__metric trust-summary__metric--blue"><strong>{counters?.buyCompleted ?? 0}</strong><span>Purchases</span></div>
          <div className="trust-summary__metric trust-summary__metric--purple"><strong>{counters?.sellCompleted ?? 0}</strong><span>Sales</span></div>
          <div className="trust-summary__metric trust-summary__metric--green"><strong>{paidOnTime}</strong><span>Paid on time</span></div>
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
                  <span>{event.title ?? 'CollectTT transaction'} · {date(event.occurredAt)}</span>
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

function ClaimsPanel({ claims }: Pick<ProfilePageProps, 'claims'>) {
  return <div className="profile-content-stack">{claims.length === 0 ? <EmptyState icon={<ShoppingBag size={22} />} title="No claims yet">Your fixed-price claims and deal history will appear here.</EmptyState> : <div className="profile-list">{claims.map((claim) => <article className="profile-list-row" key={claim.id}><div className="profile-list-row__icon profile-list-row__icon--purple"><ShoppingBag size={18} aria-hidden="true" /></div><div className="profile-list-row__main"><h3>{claim.title}</h3><p>Claimed {date(claim.claimedAt)} · {fulfillmentLabel(claim.fulfillmentPath)}</p></div><div className="profile-list-row__aside"><StatusPill value={claim.status} />{claim.transactionId !== null && <Link href={`/deals/${claim.transactionId}`}>Open deal →</Link>}</div></article>)}</div>}</div>;
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

function BidsOffersPanel({ bids, offers, receivedOffers }: Pick<ProfilePageProps, 'bids' | 'offers' | 'receivedOffers'>) {
  return <div className="profile-content-stack"><div className="profile-two-column"><section className="profile-panel"><div className="profile-panel__title"><Gavel size={19} aria-hidden="true" /><h3>Auction bids <span>{bids.length}</span></h3></div>{bids.length === 0 ? <p className="profile-panel__empty-copy">Your auction bids will show up here.</p> : <div className="profile-mini-list">{bids.slice(0, 8).map((bid) => <div className="profile-mini-row" key={bid.id}><div><strong>{bid.title}</strong><small>{date(bid.placedAt)}</small></div><div><strong>{bid.amount}</strong><StatusPill value={bid.status} /></div></div>)}</div>}</section><section className="profile-panel"><div className="profile-panel__title"><HandCoins size={19} aria-hidden="true" /><h3>Offers sent <span>{offers.length}</span></h3></div>{offers.length === 0 ? <p className="profile-panel__empty-copy">Offers you make on fixed-price listings will show up here.</p> : <div className="profile-mini-list">{offers.slice(0, 8).map((offer) => <div className="profile-mini-row" key={offer.id}><div><strong>{offer.title}</strong><small>{date(offer.createdAt)}</small></div><div><strong>{offer.amount}</strong><StatusPill value={offer.status} /></div></div>)}</div>}</section><section className="profile-panel"><div className="profile-panel__title"><HandCoins size={19} aria-hidden="true" /><h3>Offers received <span>{receivedOffers.length}</span></h3></div>{receivedOffers.length === 0 ? <p className="profile-panel__empty-copy">Offers buyers make on your listings will show up here.</p> : <div className="profile-mini-list">{receivedOffers.slice(0, 8).map((offer) => <div className="profile-mini-row" key={offer.id}><div><strong>{offer.title}</strong><small>{offer.buyerName} · {date(offer.createdAt)}</small></div><div><strong>{offer.amount}</strong><StatusPill value={offer.status} /></div></div>)}</div>}</section></div></div>;
}

function HistoryPanel({ deals }: Pick<ProfilePageProps, 'deals'>) {
  return (
    <div className="profile-content-stack">
      <section className="profile-panel profile-panel--history">
        <div className="profile-panel__title"><HeartHandshake size={19} aria-hidden="true" /><h3>Transaction history</h3></div>
        <p>Review the claims, bids, and offers that became deals. Verified outcomes are summarized in Trust &amp; Activity.</p>
      </section>
      <div className="profile-history-list">
        <h3>Recent transactions</h3>
        {deals.length === 0 ? <EmptyState icon={<WalletCards size={22} />} title="No transaction history yet">Once a claim, bid, or offer becomes a deal, its full trail will be kept here.</EmptyState> : deals.slice(0, 12).map((deal) => <article className="profile-history-row" key={deal.id}><div><strong>{deal.title}</strong><span>{deal.role} · {date(deal.createdAt)}</span></div><div><strong>{deal.amount}</strong><StatusPill value={deal.state} /></div></article>)}
      </div>
    </div>
  );
}

function SettingsPanel() {
  return <div className="profile-content-stack"><div className="profile-two-column"><section className="profile-panel"><div className="profile-panel__title"><Bell size={19} aria-hidden="true" /><h3>Notifications</h3></div><div className="profile-toggle-list"><label><span><strong>Deal reminders</strong><small>Get a nudge before payment or collection windows close.</small></span><input type="checkbox" defaultChecked /></label><label><span><strong>Bid and offer updates</strong><small>Know when you are outbid or an offer changes.</small></span><input type="checkbox" defaultChecked /></label></div></section><section className="profile-panel"><div className="profile-panel__title"><ShieldCheck size={19} aria-hidden="true" /><h3>Account security</h3></div><div className="profile-security-item"><div><strong>Email verified</strong><small>Your email is used for account recovery and verification codes.</small></div><span className="status-pill"><span aria-hidden="true" />Protected</span></div><button className="secondary profile-password-button" type="button">Change password</button></section></div><div className="profile-help-callout"><CircleHelp size={19} aria-hidden="true" /><div><strong>Need a hand?</strong><p>Read how claims, custody, and payments work in CollectTT.</p></div><ChevronRight size={18} aria-hidden="true" /></div></div>;
}

const panelByTab: Record<string, FC<ProfilePageProps>> = {
  details: ({ profile }) => <DetailsPanel profile={profile} />,
  trust: ({ counters, reputationEvents }) => <TrustPanel counters={counters} reputationEvents={reputationEvents} />,
  listings: ({ listings, deleteListingAction }) => <ListingsPanel listings={listings} deleteListingAction={deleteListingAction} />,
  claims: ({ claims }) => <ClaimsPanel claims={claims} />,
  'bids-offers': ({ bids, offers, receivedOffers }) => <BidsOffersPanel bids={bids} offers={offers} receivedOffers={receivedOffers} />,
  history: ({ deals }) => <HistoryPanel deals={deals} />,
  settings: () => <SettingsPanel />,
};

export default function ProfilePage(props: ProfilePageProps) {
  const [selectedTabIndex, setSelectedTabIndex] = useState<Key>('details');
  const ActivePanel = panelByTab[String(selectedTabIndex)] ?? panelByTab.details!;
  const selectedTab = tabs.find((tab) => tab.id === String(selectedTabIndex)) ?? tabs[0];

  return <>
    <div className="profile-page__section-bar">
      <Link className="profile-page__back" href="/listings">← Back to browse</Link>
      <div className="profile-section-heading">
        <h2>{selectedTab.label}</h2>
        {selectedTab.id === 'details' && <button className="secondary profile-edit-button" type="button"><Settings2 size={16} aria-hidden="true" /> Edit details</button>}
      </div>
    </div>
    <div className="profile-workspace">
      <div className="profile-navigation">
        <NativeSelect size="sm" aria-label="Profile sections" value={String(selectedTabIndex)} onChange={(event) => setSelectedTabIndex(event.target.value)} options={tabs.map((tab) => ({ label: tab.label, value: tab.id }))} className="profile-navigation__mobile" />
        <Tabs orientation="vertical" selectedKey={selectedTabIndex} onSelectionChange={setSelectedTabIndex} className="profile-navigation__desktop">
          <Tabs.List type="button-brand" items={tabs}>{(tab) => <Tabs.Item {...tab} />}</Tabs.List>
        </Tabs>
        <form className="profile-navigation__signout" action={props.signOutAction}>
          <button type="submit"><LogOut size={17} aria-hidden="true" /> Sign out</button>
        </form>
      </div>
      <div className="profile-tab-panel" role="tabpanel" aria-label={tabs.find((tab) => tab.id === String(selectedTabIndex))?.label}><ActivePanel {...props} /></div>
    </div>
  </>;
}
