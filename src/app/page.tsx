import Link from 'next/link';
import { ArrowRight, Gavel, Plus, Search, Store, Tag } from 'lucide-react';

import { browseListings } from '@/services/listings';
import { HomeListingCarousel, type HomeListingRow } from './home-listing-carousel';

export const dynamic = 'force-dynamic';

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
  const [recentSale, lastChance, auctions] = await Promise.all([
    browseListings({ saleType: 'straight_sale', surface: 'recent', pageSize: 16, sort: 'newest' }),
    browseListings({ saleType: 'straight_sale', surface: 'last_chance', pageSize: 16, sort: 'newest' }),
    browseListings({ saleType: 'auction', pageSize: 16, sort: 'ending_soon' }),
  ]);

  const total = recentSale.total;

  return (
    <main className="home-page">
      {/* The landing surface is intentionally brighter and more catalog-like than the operational app shell. */}
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__orb home-hero__orb--one" aria-hidden="true" />
        <div className="home-hero__orb home-hero__orb--two" aria-hidden="true" />
        <div className="home-hero__main">
          <div className="home-hero__content">
            <h1 id="home-title">Find Your Next Great <span className="home-hero__accent">Collectible.</span></h1>
            <p className="home-hero__lede">Trade cards, comics, and collectibles with collectors across Trinidad &amp; Tobago.</p>
            <form className="home-search" action="/listings" method="get" role="search">
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="home-search-input">Search listings</label>
              <input id="home-search-input" name="q" type="search" placeholder="Search listings" />
              <button type="submit">Search</button>
            </form>
            <div className="home-browse-actions" aria-label="Browse listing types">
              <Link className="home-browse-action home-browse-action--auction" href="/listings?saleType=auction">
                <span className="home-browse-action__icon"><Gavel aria-hidden="true" /></span>
                <span>Browse All Auctions Listings</span>
                <ArrowRight aria-hidden="true" />
              </Link>
              <Link className="home-browse-action home-browse-action--sale" href="/listings?saleType=straight_sale">
                <span className="home-browse-action__icon"><Tag aria-hidden="true" /></span>
                <span>Browse All Sale Listings</span>
                <ArrowRight aria-hidden="true" />
              </Link>
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

      <section className="home-sell-prompt home-store-prompt" aria-labelledby="store-prompt-title">
        <div>
          <h2 id="store-prompt-title">Have a storefront?</h2>
          <p>Want to join the community? Create a Store application here.</p>
        </div>
        <Link className="home-sell-prompt__cta" href="/store/apply">
          <Store aria-hidden="true" />Create Store Application
        </Link>
      </section>
    </main>
  );
}
