import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';

import { getListing } from '@/services/listings';
import { candidateStoresFor } from '@/services/relay-stores';
import { getCategory } from '@/domain/categories/definitions';
import { formatMoney, minimumNextBid } from '@/domain/money';
import { publicUrl } from '@/lib/storage';
import { imageVariants } from '@/services/images';
import { currentUser } from '@/lib/session';
import { db } from '@/db/client';
import { bids, claims } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { claimAction, bidAction } from './actions';
import { AuctionLive } from './bid-panel';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Cash on meetup',
  remote_ship: 'Remote payment + seller ships',
  relay: 'Relay store drop-off',
  full_service: 'Pickup & delivery',
};

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; queued?: string; bid?: string }>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const result = await getListing(id);
  if (result === null) notFound();

  const { listing, sellerName, sellerSince, images } = result;
  const category = getCategory(listing.category);
  const attributes = listing.attributes as Record<string, unknown>;
  const viewer = await currentUser();
  const isSeller = viewer?.userId === listing.sellerId;

  const isAuction = listing.saleType === 'auction';
  const isOpen = listing.status === 'active';

  // Recent bids, for the live feed.
  const recentBids = isAuction
    ? await db
        .select({
          amountCents: bids.amountCents,
          placedAt: bids.placedAt,
          bidderName: profiles.displayName,
          extended: bids.extendedAuction,
        })
        .from(bids)
        .innerJoin(profiles, eq(profiles.userId, bids.bidderId))
        .where(eq(bids.listingId, id))
        .orderBy(desc(bids.amountCents))
        .limit(8)
    : [];

  // Where the viewer stands in the claim stack, if anywhere.
  const myClaim =
    viewer !== null && !isAuction
      ? (
          await db
            .select()
            .from(claims)
            .where(and(eq(claims.listingId, id), eq(claims.claimantId, viewer.userId)))
            .limit(1)
        )[0]
      : undefined;

  const stackDepth = !isAuction
    ? (await db.select({ id: claims.id }).from(claims).where(eq(claims.listingId, id))).length
    : 0;

  const minBid = minimumNextBid(listing.currentBidCents, listing.startBidCents ?? 0);

  // Candidate relay stores for the picker — UX filtering only; claimListing re-runs
  // the real gate server-side.
  const relayCandidates = listing.fulfillmentPaths.includes('relay')
    ? await candidateStoresFor(db, id, listing.sizeClass)
    : [];

  // ★ Never offer a path the member cannot actually complete. A listing can declare
  //   `relay` while every store the seller nominated has since been deactivated or
  //   stopped accepting this size — `candidateStoresFor` then returns nothing, no
  //   picker renders, and choosing "Relay store drop-off" is refused only AFTER the
  //   form is submitted. Both the bid form and the claim form read this list.
  const choosablePaths = listing.fulfillmentPaths.filter(
    (path) => path !== 'relay' || relayCandidates.length > 0,
  );

  return (
    <main>
      <p className="muted">
        <Link href="/listings">← Browse</Link>
      </p>

      <h1>{listing.title}</h1>
      <p className="muted">
        <span className="pill">{category.label}</span>{' '}
        <span className="pill">{isAuction ? 'auction' : 'straight sale'}</span>{' '}
        <span className="pill">{listing.status}</span>
      </p>

      {flash.error !== undefined && <p className="error">{flash.error}</p>}
      {flash.queued !== undefined && flash.queued !== '' && (
        <p className="ok">
          You&apos;re #{flash.queued} in the backup queue. If the current buyer doesn&apos;t pay in
          time, it comes to you automatically.
        </p>
      )}
      {flash.bid === 'ok' && <p className="ok">Bid placed.</p>}
      {flash.bid === 'extended' && (
        <p className="ok">Bid placed — and it pushed the deadline out (soft close).</p>
      )}

      {images.length > 0 && (
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
        >
          {images.map((image) => {
            const variants = imageVariants(image.variants);
            const key = variants.card ?? variants.thumb;
            return (
              <div key={image.id} className="card">
                {key !== undefined ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={publicUrl(key)} alt="" />
                ) : (
                  <div className="thumb" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------ price / live auction */}
      {isAuction ? (
        <>
          <h2>Auction</h2>
          <AuctionLive
            endsAt={(listing.endsAt ?? new Date()).toISOString()}
            currentBid={formatMoney(listing.currentBidCents ?? listing.startBidCents ?? 0)}
            bidCount={listing.bidCount}
            extensionCount={listing.extensionCount}
            antisnipeWindowS={listing.antisnipeWindowS}
            closed={!isOpen}
          />
          {listing.buyoutCents !== null && (
            <p className="muted">Buy it now for {formatMoney(listing.buyoutCents)}.</p>
          )}
        </>
      ) : (
        <>
          <h2>Price</h2>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
            {formatMoney(listing.priceCents ?? 0)}
          </p>
        </>
      )}

      {/* ------------------------------------------------ act */}
      {viewer === null ? (
        <p style={{ marginTop: '1rem' }}>
          <Link href="/sign-in">Sign in</Link> to {isAuction ? 'bid' : 'claim this'}.
        </p>
      ) : isSeller ? (
        <p className="muted" style={{ marginTop: '1rem' }}>This is your listing.</p>
      ) : isAuction ? (
        isOpen ? (
          <form action={bidAction}>
            <input type="hidden" name="listingId" value={id} />
            <label htmlFor="amount">Your bid (minimum {formatMoney(minBid)})</label>
            <input
              id="amount"
              name="amount"
              type="text"
              inputMode="decimal"
              placeholder={(minBid / 100).toFixed(2)}
              required
            />
            {choosablePaths.length === 0 ? (
              <p className="muted">
                No settlement method is available for this listing right now — the
                seller only offers relay drop-off and none of their stores can take this
                item.
              </p>
            ) : (
              <>
                <label htmlFor="bidFulfillmentPath">How do you want to settle this?</label>
                <select id="bidFulfillmentPath" name="fulfillmentPath">
                  {choosablePaths.map((path) => (
                    <option key={path} value={path}>
                      {PATH_LABELS[path] ?? path}
                    </option>
                  ))}
                </select>
              </>
            )}
            {relayCandidates.length > 0 && (
              <>
                <label htmlFor="bidRelayStoreId">Which store will you collect from?</label>
                <select
                  id="bidRelayStoreId"
                  name="relayStoreId"
                  defaultValue={relayCandidates[0]!.id}
                >
                  {relayCandidates.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name} — {store.area}
                    </option>
                  ))}
                </select>
                <p className="muted">Only used if you pick relay drop-off.</p>
              </>
            )}
            <button type="submit">Place bid</button>
          </form>
        ) : (
          <p className="muted" style={{ marginTop: '1rem' }}>This auction has closed.</p>
        )
      ) : myClaim !== undefined ? (
        <p className="ok" style={{ marginTop: '1rem' }}>
          {myClaim.status === 'active'
            ? 'You have claimed this item.'
            : `You are #${myClaim.position} in the backup queue.`}
          {myClaim.transactionId !== null && (
            <>
              {' '}
              <Link href={`/deals/${myClaim.transactionId}`}>Open the deal →</Link>
            </>
          )}
        </p>
      ) : listing.status === 'active' || listing.status === 'claimed' ? (
        <form action={claimAction}>
          <input type="hidden" name="listingId" value={id} />
          {choosablePaths.length === 0 ? (
            <p className="muted">
              No settlement method is available for this listing right now — the seller
              only offers relay drop-off and none of their stores can take this item.
            </p>
          ) : (
            <>
              <label htmlFor="fulfillmentPath">How do you want to settle this?</label>
              <select id="fulfillmentPath" name="fulfillmentPath">
                {choosablePaths.map((path) => (
                  <option key={path} value={path}>
                    {PATH_LABELS[path] ?? path}
                  </option>
                ))}
              </select>
            </>
          )}
          {relayCandidates.length > 0 && (
            <>
              <label htmlFor="relayStoreId">Which store will you collect from?</label>
              <select id="relayStoreId" name="relayStoreId" defaultValue={relayCandidates[0]!.id}>
                {relayCandidates.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} — {store.area}
                  </option>
                ))}
              </select>
              <p className="muted">Only used if you pick relay drop-off.</p>
            </>
          )}
          <button type="submit">
            {listing.status === 'active'
              ? 'Claim it'
              : `Join the backup queue (#${stackDepth + 1})`}
          </button>
          {listing.status === 'claimed' && (
            <p className="muted">
              Someone claimed this already. Joining the queue means it comes to you
              automatically if they don&apos;t pay in time.
            </p>
          )}
        </form>
      ) : (
        <p className="muted" style={{ marginTop: '1rem' }}>This listing is no longer available.</p>
      )}

      {/* ------------------------------------------------ bid history */}
      {isAuction && recentBids.length > 0 && (
        <>
          <h2>Bids</h2>
          <table>
            <tbody>
              {recentBids.map((bid, i) => (
                <tr key={`${bid.amountCents}-${i}`}>
                  <td style={{ fontWeight: i === 0 ? 700 : 400 }}>
                    {formatMoney(bid.amountCents)}
                  </td>
                  <td>{bid.bidderName}</td>
                  <td className="muted">
                    {bid.placedAt.toLocaleString('en-TT')}
                    {bid.extended && ' · extended the auction'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {listing.description !== null && listing.description !== '' && (
        <>
          <h2>Description</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{listing.description}</p>
        </>
      )}

      <h2>{category.label} details</h2>
      <dl className="attrs">
        {category.attributes
          .filter((attr) => attributes[attr.key] !== undefined)
          .map((attr) => {
            const value = attributes[attr.key];
            const display =
              attr.type === 'enum'
                ? (attr.optionLabels?.[String(value)] ?? String(value))
                : attr.type === 'boolean'
                  ? value === true
                    ? 'Yes'
                    : 'No'
                  : String(value);
            return (
              <div key={attr.key} style={{ display: 'contents' }}>
                <dt>{attr.label}</dt>
                <dd>{display}</dd>
              </div>
            );
          })}
      </dl>

      <h2>How this deal can settle</h2>
      <ul>
        {listing.fulfillmentPaths.map((path) => (
          <li key={path}>{PATH_LABELS[path] ?? path}</li>
        ))}
      </ul>
      <p className="muted">
        Accepted payment: {listing.settlementMethods.join(', ')}. Payment always flows
        directly between buyer and seller — CollectTT never holds funds.
      </p>

      <h2>Seller</h2>
      <p>
        <Link href={`/members/${listing.sellerId}`}>{sellerName}</Link>{' '}
        <span className="muted">· member since {sellerSince.toLocaleDateString('en-TT')}</span>
      </p>
    </main>
  );
}
