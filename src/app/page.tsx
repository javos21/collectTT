import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, BookOpen, Layers3, Plus, Search, Trophy } from 'lucide-react';

import { CATEGORY_LIST } from '@/domain/categories/definitions';
import { browseListings } from '@/services/listings';
import { HomeListingCarousel, type HomeListingRow } from './home-listing-carousel';

export const dynamic = 'force-dynamic';

const CATEGORY_ICON: Record<string, ReactNode> = {
  trading_card: <Layers3 aria-hidden="true" />,
  comic: <BookOpen aria-hidden="true" />,
  collectible: <Trophy aria-hidden="true" />,
};

type BrowseRow = Awaited<ReturnType<typeof browseListings>>['rows'][number];

function toHomeListingRow(row: BrowseRow): HomeListingRow {
  return {
    id: row.id,
    title: row.title,
    primaryImageId: row.primaryImageId,
    saleType: row.saleType,
    currentBidCents: row.currentBidCents,
    startBidCents: row.startBidCents,
    priceCents: row.priceCents,
    endsAt: row.endsAt?.toISOString() ?? null,
    acceptsOffers: row.acceptsOffers,
    liveClaimCount: row.liveClaimCount,
  };
}

export default async function HomePage() {
  const [recentSale, lastChance, auctions, ...catPages] = await Promise.all([
    browseListings({ saleType: 'straight_sale', surface: 'recent', pageSize: 16, sort: 'newest' }),
    browseListings({ saleType: 'straight_sale', surface: 'last_chance', pageSize: 16, sort: 'newest' }),
    browseListings({ saleType: 'auction', pageSize: 16, sort: 'ending_soon' }),
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
          <HomeListingCarousel label="live auctions" rows={auctions.rows.map(toHomeListingRow)} />
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
          <HomeListingCarousel label="recent sale listings" rows={recentSale.rows.map(toHomeListingRow)} />
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
          <HomeListingCarousel label="last chance to claim listings" rows={lastChance.rows.map(toHomeListingRow)} />
        ) : (
          <div className="home-empty"><strong>No last-chance listings right now.</strong><span>When a fixed-price item has one or two claims, it will appear here.</span></div>
        )}
      </section>
    </main>
  );
}
