import Link from 'next/link';

import { CATEGORY_LIST } from '@/domain/categories/definitions';
import { browseListings } from '@/services/listings';
import { formatMoney } from '@/domain/money';
import { publicUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/* Authored icons — one stroke language, kept compact for the browse shortcuts. */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  trading_card: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="12" height="16" rx="2" transform="rotate(-6 9 12)" />
      <rect x="9" y="5" width="12" height="16" rx="2" transform="rotate(6 15 13)" />
      <path d="M15 9l1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z" />
    </svg>
  ),
  comic: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v15.5l-1.2-.8a3 3 0 00-3.4 0l-1.6 1.1a1 1 0 01-1.6-.8z" />
      <path d="M12 4h6.5c.8 0 1.5.7 1.5 1.5V19l-1.6-1.1a3 3 0 00-3.4 0l-1.2.8" />
      <path d="M7 8h2.5M7 11h2.5" />
    </svg>
  ),
  collectible: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M7 8h10l-1 4a4 4 0 01-8 0z" />
      <path d="M7 8V6h10v2M9.5 16h5M12 16v3M9 19h6" />
      <path d="M17 8h1.5a1.5 1.5 0 010 3H16M7 8H5.5a1.5 1.5 0 000 3H8" />
    </svg>
  ),
};

const AuctionIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M14 6l4 4M9.5 10.5l4 4M4 20h9" /><path d="M12 8l-6 6 2 2 6-6zM15 5l4 4" /></svg>
);
const TagIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg>
);
const SearchIcon = (
  <svg viewBox="0 0 24 24" {...stroke}><circle cx="10.8" cy="10.8" r="6.2" /><path d="M15.5 15.5L20 20" /></svg>
);

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Meetup',
  remote_ship: 'Ships to you',
  relay: 'Relay store',
  full_service: 'Delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  linx: 'LINX',
  other: 'Other',
};

type BrowseRow = Awaited<ReturnType<typeof browseListings>>['rows'][number];

function saleLabel(saleType: string): string {
  return saleType === 'auction' ? 'Auction' : 'For sale';
}

function priceFor(row: BrowseRow): number {
  return row.saleType === 'auction'
    ? row.currentBidCents ?? row.startBidCents ?? 0
    : row.priceCents ?? 0;
}

function valuesLabel(values: readonly string[], labels: Record<string, string>): string {
  return values.map((value) => labels[value] ?? value.replaceAll('_', ' ')).join(' · ');
}

function ListingTile({ row }: { row: BrowseRow }) {
  return (
    <Link className="home-listing-tile" href={`/listings/${row.id}`}>
      <div className="home-listing-tile__image">
        {row.primaryImageKey ? (
          <img src={publicUrl(row.primaryImageKey)} alt="" />
        ) : (
          <span aria-hidden="true">Collectible preview</span>
        )}
      </div>
      <div className="home-listing-tile__body">
        <div className="home-listing-tile__tags">
          <span className={`pill tag tag--${row.category}`}>{row.category.replace('_', ' ')}</span>
          <span className={`pill tag ${row.saleType === 'auction' ? 'tag--auction' : 'tag--sale'}`}>{saleLabel(row.saleType)}</span>
        </div>
        <h3>{row.title}</h3>
        {row.description !== null && row.description !== '' && <p>{row.description}</p>}
        <div className="home-listing-tile__meta">
          <strong className="num">{formatMoney(priceFor(row))}</strong>
          {row.saleType === 'auction' && <span>{row.bidCount} bid{row.bidCount === 1 ? '' : 's'}</span>}
        </div>
        <small>{valuesLabel(row.fulfillmentPaths, PATH_LABELS)} · {valuesLabel(row.settlementMethods, PAYMENT_LABELS)}</small>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const [recent, auctions, buynow, ...catPages] = await Promise.all([
    browseListings({ pageSize: 8, sort: 'newest' }),
    browseListings({ saleType: 'auction', pageSize: 8, sort: 'ending_soon' }),
    browseListings({ saleType: 'straight_sale', pageSize: 1 }),
    ...CATEGORY_LIST.map((category) => browseListings({ category: category.key, pageSize: 1 })),
  ]);

  const total = recent.total;
  const catCounts = new Map(CATEGORY_LIST.map((category, index) => [category.key, catPages[index]?.total ?? 0]));

  return (
    <main className="home-page">
      {/* The landing surface is intentionally brighter and more catalog-like than the operational app shell. */}
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__orb home-hero__orb--one" aria-hidden="true" />
        <div className="home-hero__orb home-hero__orb--two" aria-hidden="true" />
        <div className="home-hero__main">
          <div className="home-hero__content">
            <img className="home-hero__logo" src="/assets/collecttt_logo.png" alt="CollectTT — Trinidad's Collector Platform" />
            <h1 id="home-title">Find your next great collectible.</h1>
            <p className="home-hero__lede">Trade cards, comics, and collectibles with collectors across Trinidad &amp; Tobago.</p>
            <form className="home-search" action="/listings" method="get" role="search">
              {SearchIcon}
              <label className="sr-only" htmlFor="home-search-input">Search listings</label>
              <input id="home-search-input" name="q" type="search" placeholder="Search cards, comics, collectibles" />
              <button type="submit">Search</button>
            </form>
            <p className="home-search__hint">Search active listings by title or description</p>
          </div>
          <div className="home-hero__art">
            <img src="/assets/collecttt-hero-v2.png" alt="Abstract trading cards, graded collectible, comic, and geometric figure" />
          </div>
        </div>

        <div className="home-sale-types" aria-label="Shop by sale type">
          <Link className="home-sale-type home-sale-type--auction" href="/listings?saleType=auction">
            <span className="home-sale-type__icon">{AuctionIcon}</span>
            <span><strong>Live auctions</strong><small>{auctions.total} running now</small></span>
            <span className="home-sale-type__arrow" aria-hidden="true">↗</span>
          </Link>
          <Link className="home-sale-type home-sale-type--sale" href="/listings?saleType=straight_sale">
            <span className="home-sale-type__icon">{TagIcon}</span>
            <span><strong>Fixed price</strong><small>{buynow.total} ready to claim</small></span>
            <span className="home-sale-type__arrow" aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <section className="home-section home-categories" aria-labelledby="category-title">
        <div className="home-section__heading">
          <div><h2 id="category-title">Explore categories</h2><p>Start with what you collect.</p></div>
          <Link href="/listings">View all <span aria-hidden="true">→</span></Link>
        </div>
        <div className="home-category-grid">
          {CATEGORY_LIST.map((category) => (
            <Link className="home-category" key={category.key} href={`/listings?category=${category.key}`}>
              <span className="home-category__icon">{CATEGORY_ICON[category.key]}</span>
              <span><strong>{category.label}s</strong><small>{catCounts.get(category.key) ?? 0} listings</small></span>
              <span className="home-category__arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="auction-title">
        <div className="home-section__heading">
          <div><h2 id="auction-title">Live auctions</h2><p>See what collectors are bidding on now.</p></div>
          <Link href="/listings?saleType=auction">See all <span aria-hidden="true">→</span></Link>
        </div>
        {auctions.rows.length > 0 ? (
          <div className="home-listing-grid">{auctions.rows.map((row) => <ListingTile key={row.id} row={row} />)}</div>
        ) : (
          <div className="home-empty"><strong>No live auctions yet.</strong><span>Check back soon or list something for the community.</span></div>
        )}
      </section>

      <section className="home-section home-section--recent" aria-labelledby="recent-title">
        <div className="home-section__heading">
          <div><h2 id="recent-title">Recent listings</h2><p>Fresh finds, just added.</p></div>
          <Link href="/listings">Browse everything <span aria-hidden="true">→</span></Link>
        </div>
        {recent.rows.length > 0 ? (
          <div className="home-listing-grid">{recent.rows.map((row) => <ListingTile key={row.id} row={row} />)}</div>
        ) : (
          <div className="home-empty"><strong>Nothing listed yet.</strong><span>Be the first to put something up for the community.</span><Link className="button" href="/listings/new">Create a listing</Link></div>
        )}
        <p className="home-catalog-note"><span className="home-catalog-note__dot" aria-hidden="true" /> {total} active listing{total === 1 ? '' : 's'} across the catalog · secure local handoff options available</p>
      </section>
    </main>
  );
}
