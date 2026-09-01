import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BadgeCheck, BookOpen, Clock3, Eye, Layers3, Plus, Search, Trophy } from 'lucide-react';

import { CATEGORY_LIST } from '@/domain/categories/definitions';
import { browseListings } from '@/services/listings';
import { formatMoney } from '@/domain/money';

export const dynamic = 'force-dynamic';

const CATEGORY_ICON: Record<string, ReactNode> = {
  trading_card: <Layers3 aria-hidden="true" />,
  comic: <BookOpen aria-hidden="true" />,
  collectible: <Trophy aria-hidden="true" />,
};

type BrowseRow = Awaited<ReturnType<typeof browseListings>>['rows'][number];

function priceFor(row: BrowseRow): number {
  return row.saleType === 'auction'
    ? row.currentBidCents ?? row.startBidCents ?? 0
    : row.priceCents ?? 0;
}

function timeLeft(endsAt: Date | null): string {
  if (endsAt === null) return 'Ends soon';
  const minutes = Math.max(0, Math.floor((endsAt.getTime() - Date.now()) / 60_000));
  if (minutes < 1) return 'Ending now';
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m left`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h left`;
}

function auctionUrgency(endsAt: Date | null): 'urgent' | 'soon' | 'healthy' {
  if (endsAt === null) return 'soon';
  const hours = (endsAt.getTime() - Date.now()) / 3_600_000;
  if (hours < 12) return 'urgent';
  if (hours < 24) return 'soon';
  return 'healthy';
}

function ListingTile({ row }: { row: BrowseRow }) {
  return (
    <Link className="home-listing-tile" href={`/listings/${row.id}`}>
      <div className="home-listing-tile__image">
        {row.primaryImageId ? (
          <img src={`/api/images/${row.primaryImageId}?variant=card`} alt="" />
        ) : (
          <span aria-hidden="true">Collectible preview</span>
        )}
      </div>
      <div className="home-listing-tile__body">
        <h3>{row.title}</h3>
        {row.saleType === 'auction' ? (
          <div className="home-listing-tile__auction-meta">
            <span className="home-listing-tile__price-label">Current bid</span>
            <strong className="num">{formatMoney(priceFor(row))}</strong>
            <span className={`home-listing-tile__time home-listing-tile__time--${auctionUrgency(row.endsAt)}`}>
              <Clock3 aria-hidden="true" />{timeLeft(row.endsAt)}
            </span>
          </div>
        ) : (
          <div className="home-listing-tile__sale-meta">
            <span className="home-listing-tile__price-label">Sale Price</span>
            <strong className="num">{formatMoney(priceFor(row))}</strong>
            {row.acceptsOffers && <span className="home-listing-tile__offers"><BadgeCheck aria-hidden="true" />Offers accepted</span>}
            {row.liveClaimCount > 0 && <span className="home-listing-tile__offers">First claim in progress · {row.liveClaimCount}/3 claimed</span>}
          </div>
        )}
        <span className="home-listing-tile__cta"><Eye aria-hidden="true" />{row.liveClaimCount > 0 ? 'Join queue' : 'View Listing'}</span>
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const [recentSale, lastChance, auctions, ...catPages] = await Promise.all([
    browseListings({ saleType: 'straight_sale', surface: 'recent', pageSize: 8, sort: 'newest' }),
    browseListings({ saleType: 'straight_sale', surface: 'last_chance', pageSize: 8, sort: 'newest' }),
    browseListings({ saleType: 'auction', pageSize: 8, sort: 'ending_soon' }),
    ...CATEGORY_LIST.map((category) => browseListings({ category: category.key, pageSize: 1 })),
  ]);

  const total = recentSale.total;
  const catCounts = new Map(CATEGORY_LIST.map((category, index) => [category.key, catPages[index]?.total ?? 0]));

  return (
    <main className="home-page">
      {/* The landing surface is intentionally brighter and more catalog-like than the operational app shell. */}
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__orb home-hero__orb--one" aria-hidden="true" />
        <div className="home-hero__orb home-hero__orb--two" aria-hidden="true" />
        <div className="home-hero__main">
          <div className="home-hero__content">
            <h1 id="home-title">Find Your Next Great Collectible.</h1>
            <p className="home-hero__lede">Trade cards, comics, and collectibles with collectors across Trinidad &amp; Tobago.</p>
            <form className="home-search" action="/listings" method="get" role="search">
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="home-search-input">Search listings</label>
              <input id="home-search-input" name="q" type="search" placeholder="Search listings" />
              <button type="submit">Search</button>
            </form>
            <div className="home-category-grid" aria-labelledby="category-title">
              <h2 className="sr-only" id="category-title">Explore categories</h2>
              {CATEGORY_LIST.map((category) => (
                <Link className="home-category" key={category.key} href={`/listings?category=${category.key}`}>
                  <span className="home-category__icon">{CATEGORY_ICON[category.key]}</span>
                  <span><strong>{category.label}s</strong><small>{catCounts.get(category.key) ?? 0} listings</small></span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="home-section" aria-labelledby="auction-title">
        <div className="home-section__heading">
          <div><h2 id="auction-title">Live Auctions</h2></div>
          <Link href="/listings?saleType=auction">See All <ArrowRight aria-hidden="true" /></Link>
        </div>
        {auctions.rows.length > 0 ? (
          <div className="home-listing-grid">{auctions.rows.map((row) => <ListingTile key={row.id} row={row} />)}</div>
        ) : (
          <div className="home-empty"><strong>No live auctions yet.</strong><span>Check back soon or list something for the community.</span></div>
        )}
      </section>

      <section className="home-sell-prompt" aria-labelledby="sell-prompt-title">
        <div>
          <h2 id="sell-prompt-title">Have something to sell?</h2>
          <p>Give your collectible a new home with collectors across Trinidad &amp; Tobago.</p>
        </div>
        <Link className="home-sell-prompt__cta" href="/listings/new">
          <Plus aria-hidden="true" />Create Listing
        </Link>
      </section>

      <section className="home-section home-section--recent" aria-labelledby="recent-title">
        <div className="home-section__heading">
          <div><h2 id="recent-title">Recent Sale Listings</h2></div>
          <Link href="/listings?saleType=straight_sale">See All <ArrowRight aria-hidden="true" /></Link>
        </div>
        {recentSale.rows.length > 0 ? (
          <div className="home-listing-grid">{recentSale.rows.map((row) => <ListingTile key={row.id} row={row} />)}</div>
        ) : (
          <div className="home-empty"><strong>No sale listings yet.</strong><span>Be the first to put something up for the community.</span><Link className="button" href="/listings/new">Create a listing</Link></div>
        )}
        <p className="home-catalog-note"><span className="home-catalog-note__dot" aria-hidden="true" /> {total} active listing{total === 1 ? '' : 's'} across the catalog · secure local handoff options available</p>
      </section>

      <section className="home-section home-section--recent" aria-labelledby="last-chance-title">
        <div className="home-section__heading">
          <div><h2 id="last-chance-title">Last chance to claim</h2><p>These items have a claim in progress, but there is still room in the queue.</p></div>
          <Link href="/listings?saleType=straight_sale">See All <ArrowRight aria-hidden="true" /></Link>
        </div>
        {lastChance.rows.length > 0 ? (
          <div className="home-listing-grid">{lastChance.rows.map((row) => <ListingTile key={row.id} row={row} />)}</div>
        ) : (
          <div className="home-empty"><strong>No last-chance listings right now.</strong><span>When a fixed-price item has one or two claims, it will appear here.</span></div>
        )}
      </section>
    </main>
  );
}
