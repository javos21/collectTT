'use client';

import { type FC, type ReactNode, useState } from 'react';
import type { Key } from 'react-aria-components';
import Link from 'next/link';
import {
  BadgeCheck,
  Bell,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Clock3,
  Gavel,
  HandCoins,
  HeartHandshake,
  ListTodo,
  LogOut,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Star,
  UserRound,
  WalletCards,
} from 'lucide-react';

import { Tabs } from '@/components/application/tabs/tabs';
import { NativeSelect } from '@/components/base/select/select-native';

const tabs = [
  { id: 'details', label: 'My Details' },
  { id: 'collect-dropoff', label: 'Collect / Drop-Off' },
  { id: 'listings', label: 'My Listings' },
  { id: 'claims', label: 'Claims' },
  { id: 'bids-offers', label: 'Bids / Offers' },
  { id: 'history', label: 'History & Ratings' },
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
  ratingAverage: number | null;
  ratingCount: number;
};

type CounterData = {
  buyClaimsTotal: number;
  buyCompleted: number;
  buyRenegedTotal: number;
  buyPaidOnTime: number;
  sellCompleted: number;
  sellRenegedTotal: number;
};

type ListingData = { id: string; title: string; category: string; saleType: string; status: string; amount: string };
type ClaimData = { id: string; title: string; status: string; position: number; fulfillmentPath: string; claimedAt: string };
type BidData = { id: string; title: string; amount: string; status: string; placedAt: string };
type OfferData = { id: string; title: string; amount: string; status: string; createdAt: string };
type DealData = { id: string; title: string; role: string; amount: string; state: string; fulfillmentPath: string; createdAt: string; completedAt: string | null };
type RatingData = { id: string; title: string; stars: number; comment: string | null; direction: string; submittedAt: string };

interface ProfilePageProps {
  signOutAction: () => Promise<void>;
  profile: ProfileData;
  counters: CounterData | null;
  listings: ListingData[];
  claims: ClaimData[];
  bids: BidData[];
  offers: OfferData[];
  deals: DealData[];
  ratings: RatingData[];
  objectiveLines: string[];
}

const date = (value: string) => new Date(value).toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const fulfillmentLabel = (value: string) => ({ cash_meetup: 'Cash meetup', remote_ship: 'Ship to buyer', relay: 'Store drop-off', full_service: 'Pickup & delivery' })[value] ?? titleCase(value);

const DetailRow: FC<{ icon: ReactNode; label: string; value: ReactNode }> = ({ icon, label, value }) => (
  <div className="profile-detail-row">
    <div className="profile-detail-row__icon" aria-hidden="true">{icon}</div>
    <div><span>{label}</span><strong>{value}</strong></div>
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

function DetailsPanel({ profile, counters, listings, objectiveLines }: Pick<ProfilePageProps, 'profile' | 'counters' | 'listings' | 'objectiveLines'>) {
  const ratingLabel = profile.ratingAverage === null ? 'No ratings yet' : `${profile.ratingAverage.toFixed(1)} / 5`;
  return (
    <div className="profile-content-stack">
      <div className="profile-detail-grid">
        <section className="profile-panel profile-panel--details">
          <DetailRow icon={<UserRound size={19} />} label="Display name" value={profile.displayName} />
          <DetailRow icon={<Mail size={19} />} label="Email address" value={profile.email} />
          <DetailRow icon={<Phone size={19} />} label="Phone number" value={profile.phoneE164 ?? 'Add your phone number'} />
          <DetailRow icon={<CalendarDays size={19} />} label="Member since" value={new Date(profile.memberSince).toLocaleDateString('en-TT', { month: 'long', year: 'numeric' })} />
          <div className="profile-address-block">
            <div className="profile-address-block__title"><MapPin size={19} aria-hidden="true" /><div><strong>Delivery Address</strong><span>Used for deliveries and collections.</span></div></div>
            <div className="profile-address-fields">
              <DetailRow icon={<MapPin size={17} />} label="Address line 1" value={profile.deliveryAddressLine1 ?? 'Add address line 1'} />
              <DetailRow icon={<MapPin size={17} />} label="Address line 2" value={profile.deliveryAddressLine2 ?? 'Add address line 2'} />
              <DetailRow icon={<Building2 size={17} />} label="City" value={profile.deliveryCity ?? 'Add your city'} />
              <DetailRow icon={<MapPin size={17} />} label="Country" value={profile.deliveryCountry} />
            </div>
            <p className="profile-address-block__note">This app is only for use within Trinidad and Tobago and does not apply elsewhere.</p>
          </div>
        </section>
        <section className="profile-panel profile-panel--trust">
          <div className="profile-panel__title"><ShieldCheck size={19} aria-hidden="true" /><h3>Your trust snapshot</h3></div>
          <div className="trust-score"><strong>{ratingLabel}</strong></div>
          <div className="trust-bars">
            <div><span>Purchases completed</span><strong>{counters?.buyCompleted ?? 0}</strong></div>
            <div><span>Sales completed</span><strong>{counters?.sellCompleted ?? 0}</strong></div>
            <div><span>Paid on time</span><strong>{counters?.buyPaidOnTime ?? 0}</strong></div>
          </div>
          <p className="profile-panel__note">Ratings are kept separate from the objective record that powers account protections.</p>
        </section>
      </div>
      <section className="profile-panel profile-panel--activity">
        <div className="profile-section-heading profile-section-heading--tight">
          <div><h2>Activity overview</h2></div>
          <span className="profile-section-heading__hint">{listings.length} listing{listings.length === 1 ? '' : 's'} created</span>
        </div>
        {objectiveLines.length > 0 ? <ul className="profile-fact-list">{objectiveLines.map((line) => <li key={line}><BadgeCheck size={17} aria-hidden="true" />{line}</li>)}</ul> : <p className="muted">Your activity summary will appear here as you buy and sell.</p>}
      </section>
    </div>
  );
}

function ClaimsPanel({ claims }: Pick<ProfilePageProps, 'claims'>) {
  return <div className="profile-content-stack">{claims.length === 0 ? <EmptyState icon={<ShoppingBag size={22} />} title="No claims yet">When you claim a fixed-price listing, it will appear here with its place in the queue.</EmptyState> : <div className="profile-list">{claims.map((claim) => <article className="profile-list-row" key={claim.id}><div className="profile-list-row__icon profile-list-row__icon--purple"><ShoppingBag size={18} aria-hidden="true" /></div><div className="profile-list-row__main"><h3>{claim.title}</h3><p>Claimed {date(claim.claimedAt)} · {fulfillmentLabel(claim.fulfillmentPath)}</p></div><div className="profile-list-row__aside"><StatusPill value={claim.status} /><small>Queue position {claim.position}</small></div></article>)}</div>}</div>;
}

function ListingsPanel({ listings }: Pick<ProfilePageProps, 'listings'>) {
  return <div className="profile-content-stack">{listings.length === 0 ? <EmptyState icon={<ListTodo size={22} />} title="No listings yet">Create a listing to start building your seller history.</EmptyState> : <div className="profile-list">{listings.map((listing) => <article className="profile-list-row" key={listing.id}><div className="profile-list-row__icon profile-list-row__icon--purple"><ListTodo size={18} aria-hidden="true" /></div><div className="profile-list-row__main"><h3><Link href={`/listings/${listing.id}`}>{listing.title}</Link></h3><p>{titleCase(listing.category)} · {titleCase(listing.saleType)} · {listing.amount}</p></div><div className="profile-list-row__aside"><StatusPill value={listing.status} />{(listing.status === 'active' || listing.status === 'draft') && <Link href={`/listings/${listing.id}/edit`}>Edit</Link>}</div></article>)}</div>}</div>;
}

function BidsOffersPanel({ bids, offers }: Pick<ProfilePageProps, 'bids' | 'offers'>) {
  return <div className="profile-content-stack"><div className="profile-two-column"><section className="profile-panel"><div className="profile-panel__title"><Gavel size={19} aria-hidden="true" /><h3>Auction bids <span>{bids.length}</span></h3></div>{bids.length === 0 ? <p className="profile-panel__empty-copy">Your auction bids will show up here.</p> : <div className="profile-mini-list">{bids.slice(0, 8).map((bid) => <div className="profile-mini-row" key={bid.id}><div><strong>{bid.title}</strong><small>{date(bid.placedAt)}</small></div><div><strong>{bid.amount}</strong><StatusPill value={bid.status} /></div></div>)}</div>}</section><section className="profile-panel"><div className="profile-panel__title"><HandCoins size={19} aria-hidden="true" /><h3>Offers sent <span>{offers.length}</span></h3></div>{offers.length === 0 ? <p className="profile-panel__empty-copy">Offers you make on fixed-price listings will show up here.</p> : <div className="profile-mini-list">{offers.slice(0, 8).map((offer) => <div className="profile-mini-row" key={offer.id}><div><strong>{offer.title}</strong><small>{date(offer.createdAt)}</small></div><div><strong>{offer.amount}</strong><StatusPill value={offer.status} /></div></div>)}</div>}</section></div></div>;
}

function CollectionPanel({ deals }: Pick<ProfilePageProps, 'deals'>) {
  const collectionDeals = deals.filter((deal) => ['relay', 'full_service'].includes(deal.fulfillmentPath) && deal.state === 'open');
  return <div className="profile-content-stack">{collectionDeals.length === 0 ? <EmptyState icon={<PackageCheck size={22} />} title="Nothing waiting at a store">Store collections and seller drop-offs will appear here when a deal is in progress.</EmptyState> : <div className="profile-list">{collectionDeals.map((deal) => <article className="profile-list-row" key={deal.id}><div className="profile-list-row__icon profile-list-row__icon--green"><PackageCheck size={18} aria-hidden="true" /></div><div className="profile-list-row__main"><h3>{deal.title}</h3><p>{deal.role} · {fulfillmentLabel(deal.fulfillmentPath)}</p></div><div className="profile-list-row__aside"><StatusPill value="open" /><ChevronRight size={18} aria-hidden="true" /></div></article>)}</div>}</div>;
}

function HistoryPanel({ deals, ratings }: Pick<ProfilePageProps, 'deals' | 'ratings'>) {
  return <div className="profile-content-stack"><section className="profile-panel profile-panel--history"><div className="profile-panel__title"><HeartHandshake size={19} aria-hidden="true" /><h3>How your activity affects your rating</h3></div><p>Your rating is built from revealed feedback after completed transactions. Objective outcomes such as paid-on-time and completed deals are tracked separately, so one opinion never changes your account standing.</p><div className="history-metrics"><div><BadgeCheck size={18} aria-hidden="true" /><strong>{deals.filter((deal) => deal.state === 'completed').length}</strong><span>completed transactions</span></div><div><Star size={18} aria-hidden="true" /><strong>{ratings.length}</strong><span>ratings received</span></div><div><Clock3 size={18} aria-hidden="true" /><strong>{deals.filter((deal) => deal.state !== 'completed').length}</strong><span>open or closed elsewhere</span></div></div></section><div className="profile-history-list"><h3>Recent transactions</h3>{deals.length === 0 ? <EmptyState icon={<WalletCards size={22} />} title="No transaction history yet">Once a claim, bid, or offer becomes a deal, its full trail will be kept here.</EmptyState> : deals.slice(0, 12).map((deal) => <article className="profile-history-row" key={deal.id}><div><strong>{deal.title}</strong><span>{deal.role} · {date(deal.createdAt)}</span></div><div><strong>{deal.amount}</strong><StatusPill value={deal.state} /></div></article>)}</div><div className="profile-history-list"><h3>Ratings received</h3>{ratings.length === 0 ? <p className="muted">No ratings have been revealed yet.</p> : ratings.map((rating) => <article className="profile-history-row profile-history-row--rating" key={rating.id}><div><strong>{rating.title}</strong><span>{rating.comment ?? 'No written comment'} · {date(rating.submittedAt)}</span></div><div className="star-rating" aria-label={`${rating.stars} out of 5 stars`}>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={15} fill={index < rating.stars ? 'currentColor' : 'none'} aria-hidden="true" />)}</div></article>)}</div></div>;
}

function SettingsPanel() {
  return <div className="profile-content-stack"><div className="profile-two-column"><section className="profile-panel"><div className="profile-panel__title"><Bell size={19} aria-hidden="true" /><h3>Notifications</h3></div><div className="profile-toggle-list"><label><span><strong>Deal reminders</strong><small>Get a nudge before payment or collection windows close.</small></span><input type="checkbox" defaultChecked /></label><label><span><strong>Bid and offer updates</strong><small>Know when you are outbid or an offer changes.</small></span><input type="checkbox" defaultChecked /></label></div></section><section className="profile-panel"><div className="profile-panel__title"><ShieldCheck size={19} aria-hidden="true" /><h3>Account security</h3></div><div className="profile-security-item"><div><strong>Email verified</strong><small>Your email is used for account recovery and verification codes.</small></div><span className="status-pill"><span aria-hidden="true" />Protected</span></div><button className="secondary profile-password-button" type="button">Change password</button></section></div><div className="profile-help-callout"><CircleHelp size={19} aria-hidden="true" /><div><strong>Need a hand?</strong><p>Read how claims, custody, payments, and ratings work in CollectTT.</p></div><ChevronRight size={18} aria-hidden="true" /></div></div>;
}

const panelByTab: Record<string, FC<ProfilePageProps>> = {
  details: ({ profile, counters, listings, objectiveLines }) => <DetailsPanel profile={profile} counters={counters} listings={listings} objectiveLines={objectiveLines} />,
  'collect-dropoff': ({ deals }) => <CollectionPanel deals={deals} />,
  listings: ({ listings }) => <ListingsPanel listings={listings} />,
  claims: ({ claims }) => <ClaimsPanel claims={claims} />,
  'bids-offers': ({ bids, offers }) => <BidsOffersPanel bids={bids} offers={offers} />,
  history: ({ deals, ratings }) => <HistoryPanel deals={deals} ratings={ratings} />,
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
