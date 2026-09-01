import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';

import { getListing } from '@/services/listings';
import { candidateStoresFor } from '@/services/relay-stores';
import { getCategory } from '@/domain/categories/definitions';
import { formatMoney, minimumNextBid } from '@/domain/money';
import { imageVariants } from '@/services/images';
import { currentUser } from '@/lib/session';
import { db } from '@/db/client';
import { bids, claims } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { acceptOfferAction, bidAction, claimAction, rejectOfferAction, submitOfferAction } from './actions';
import { AuctionLive } from './bid-panel';
import { latestOfferForBuyer, pendingOffersForSeller } from '@/services/offers';
import { SignInRequiredModal } from '@/components/sign-in-required-modal';

export const dynamic = 'force-dynamic';

const PATH_LABELS: Record<string, string> = {
  cash_meetup: 'Cash on meetup',
  remote_ship: 'Remote payment + seller ships',
  relay: 'Store drop-off',
  full_service: 'Pickup & delivery',
};

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; queued?: string; bid?: string; offer?: string; auth?: string }>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const result = await getListing(id);
  if (result === null) notFound();

  const { listing, sellerName, sellerSince, images } = result;
  const category = getCategory(listing.category);
  const attributes = listing.attributes as Record<string, unknown>;
  const viewer = await currentUser();
  const showSignInModal = viewer === null && flash.auth === 'buy';
  const isSeller = viewer?.userId === listing.sellerId;
  const pendingOffers = isSeller && listing.saleType === 'straight_sale'
    ? await pendingOffersForSeller(id, viewer.userId)
    : [];
  const myOffer = viewer !== null && !isSeller && listing.saleType === 'straight_sale'
    ? await latestOfferForBuyer(id, viewer.userId)
    : null;

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

  // Candidate stores for the picker — UX filtering only; claimListing re-runs
  // the real gate server-side.
  const relayCandidates = listing.fulfillmentPaths.includes('relay')
    ? await candidateStoresFor(db, id, listing.sizeClass)
    : [];

  // ★ Never offer a path the member cannot actually complete. A listing can declare
  //   `relay` while every store the seller nominated has since been deactivated or
  //   stopped accepting this size — `candidateStoresFor` then returns nothing, no
  //   picker renders, and choosing "Store drop-off" is refused only AFTER the
  //   form is submitted. Both the bid form and the claim form read this list.
  const choosablePaths = listing.fulfillmentPaths.filter(
    (path) => path !== 'relay' || relayCandidates.length > 0,
  );

  const statusBadge =
    listing.status === 'active'
      ? { cls: 'badge badge--live', text: 'Available' }
      : listing.status === 'claimed'
        ? { cls: 'badge badge--claimed', text: 'Claimed' }
        : { cls: 'badge badge--ended', text: listing.status.replace(/_/g, ' ') };

  const settleForm = (idPrefix: string, fieldPrefix = '') =>
    choosablePaths.length === 0 ? (
      <p className="buybox__note">
        No settlement method is available right now — the seller only offers store
        drop-off and none of their stores can take this item.
      </p>
    ) : (
      <>
        <label htmlFor={`${idPrefix}fulfillmentPath`}>How do you want to settle this?</label>
        <select id={`${idPrefix}fulfillmentPath`} name={`${fieldPrefix}fulfillmentPath`}>
          {choosablePaths.map((path) => (
            <option key={path} value={path}>
              {PATH_LABELS[path] ?? path}
            </option>
          ))}
        </select>
        {relayCandidates.length > 0 && (
          <>
            <label htmlFor={`${idPrefix}relayStoreId`}>Which store will you collect from?</label>
            <select
              id={`${idPrefix}relayStoreId`}
              name={`${fieldPrefix}relayStoreId`}
              defaultValue={relayCandidates[0]!.id}
            >
              {relayCandidates.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name} — {store.area}
                </option>
              ))}
            </select>
            <p className="buybox__note">Only used if you pick store drop-off.</p>
          </>
        )}
      </>
    );

  const attributeRows = category.attributes.filter(
    (attr) => attributes[attr.key] !== undefined,
  );

  return (
    <main>
      {showSignInModal && (
        <SignInRequiredModal
          intent="buy"
          returnTo={`/listings/${id}#buy-panel`}
          cancelTo={`/listings/${id}#buy-panel`}
        />
      )}
      <div className="listing-head">
        <Link className="breadcrumb" href="/listings">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Browse
        </Link>
        <h1>{listing.title}</h1>
        <div className="badge-row">
          <span className="badge">{category.label}</span>
          <span className="badge">{isAuction ? 'Auction' : 'Straight sale'}</span>
          <span className={statusBadge.cls}>{statusBadge.text}</span>
        </div>
      </div>

      {flash.error !== undefined && (
        <div className="alert alert--error" role="alert">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v6m0 3.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span>{flash.error}</span>
        </div>
      )}
      {flash.queued !== undefined && flash.queued !== '' && (
        <div className="alert alert--info">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            You&apos;re <strong>#{flash.queued}</strong> in the backup queue. If the current buyer
            doesn&apos;t pay in time, it comes to you automatically.
          </span>
        </div>
      )}
      {flash.bid === 'ok' && <div className="alert alert--info">Bid placed.</div>}
      {flash.bid === 'extended' && (
        <div className="alert alert--info">
          Bid placed — and it pushed the deadline out (soft close).
        </div>
      )}
      {flash.offer === 'sent' && (
        <div className="alert alert--info" role="status">
          Offer sent. The seller can accept or reject it while the listing is available.
        </div>
      )}
      {flash.offer === 'rejected' && (
        <div className="alert alert--info" role="status">Offer rejected.</div>
      )}

      <div className="listing-body">
        {/* ------------------------------------------------ gallery */}
        <div className="gallery">
          {images.length > 0 ? (
            <>
              <div className="gallery__track">
                {images.map((image, index) => {
                  const variants = imageVariants(image.variants);
                  return (
                    <div className="gallery__slide" key={image.id} id={`img-${image.id}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/images/${image.id}?variant=${variants.full !== undefined ? 'full' : variants.card !== undefined ? 'card' : 'thumb'}`} alt={`${listing.title} — photo ${index + 1}`} />
                    </div>
                  );
                })}
              </div>
              {images.length > 1 && (
                <div className="gallery__rail">
                  {images.map((image, index) => {
                    const variants = imageVariants(image.variants);
                    return (
                      <a
                        className="gallery__thumb"
                        key={image.id}
                        href={`#img-${image.id}`}
                        aria-label={`View photo ${index + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/images/${image.id}?variant=${variants.thumb !== undefined ? 'thumb' : variants.card !== undefined ? 'card' : 'full'}`} alt="" />
                      </a>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="gallery__empty">No photos yet</div>
          )}
        </div>

        {/* ------------------------------------------------ buy box */}
        <aside id="buy-panel" className="buybox">
          {isAuction ? (
            <>
              <p className="buybox__price-label">Current bid</p>
              <AuctionLive
                endsAt={(listing.endsAt ?? new Date()).toISOString()}
                currentBid={formatMoney(listing.currentBidCents ?? listing.startBidCents ?? 0)}
                bidCount={listing.bidCount}
                extensionCount={listing.extensionCount}
                antisnipeWindowS={listing.antisnipeWindowS}
                closed={!isOpen}
              />
              {listing.buyoutCents !== null && (
                <p className="buybox__note">Buy it now for {formatMoney(listing.buyoutCents)}.</p>
              )}
            </>
          ) : (
            <>
              <p className="buybox__price-label">Price</p>
              <p className="buybox__price">{formatMoney(listing.priceCents ?? 0)}</p>
            </>
          )}

          {/* ------------------------------------------------ act */}
          {viewer === null ? (
            <div className="buybox__state">
              <Link href={`/listings/${id}?auth=buy#buy-panel`}>sign in</Link> to {isAuction ? 'bid' : 'claim this or make an offer'}.
            </div>
          ) : isSeller ? (
            <div className="buybox__state">
              This is your listing.
              {pendingOffers.length > 0 && ` ${pendingOffers.length} offer${pendingOffers.length === 1 ? '' : 's'} waiting.`}
              {(listing.status === 'active' || listing.status === 'draft') && (
                <><br /><Link href={`/listings/${id}/edit`}>Edit listing →</Link></>
              )}
            </div>
          ) : isAuction ? (
            isOpen ? (
              <form className="buybox__form" action={bidAction}>
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
                {settleForm('bid-')}
                <button type="submit">Place bid</button>
              </form>
            ) : (
              <div className="buybox__state">This auction has closed.</div>
            )
          ) : myClaim !== undefined ? (
            <div className="buybox__state">
              {myClaim.status === 'active'
                ? 'You have claimed this item.'
                : `You are #${myClaim.position} in the backup queue.`}
              {myClaim.transactionId !== null && (
                <>
                  {' '}
                  <Link href={`/deals/${myClaim.transactionId}`}>Open the deal →</Link>
                </>
              )}
            </div>
          ) : listing.status === 'active' || listing.status === 'claimed' ? (
            <form className="buybox__form" action={claimAction}>
              <input type="hidden" name="listingId" value={id} />
              {settleForm('')}
              <button type="submit">
                {listing.status === 'active'
                  ? 'Claim it'
                  : `Join the backup queue (#${stackDepth + 1})`}
              </button>
              {listing.status === 'claimed' && (
                <p className="buybox__note">
                  Someone claimed this already. Joining the queue means it comes to you
                  automatically if they don&apos;t pay in time.
                </p>
              )}
            </form>
          ) : (
            <div className="buybox__state">This listing is no longer available.</div>
          )}

          {!isAuction && viewer !== null && !isSeller && listing.status === 'active' && (
            <>
              <hr />
              {myOffer?.status === 'pending' ? (
                <div className="buybox__state">
                  Your offer of <strong>{formatMoney(myOffer.amountCents)}</strong> is waiting for
                  the seller. You can still claim at the asking price.
                </div>
              ) : (
                <form className="buybox__form" action={submitOfferAction}>
                  <input type="hidden" name="listingId" value={id} />
                  <p className="buybox__price-label">Make an offer</p>
                  <label htmlFor="offerAmount">Your offer</label>
                  <input
                    id="offerAmount"
                    name="offerAmount"
                    type="text"
                    inputMode="decimal"
                    placeholder={(Math.max(1, (listing.priceCents ?? 1) - 1) / 100).toFixed(2)}
                    required
                  />
                  <p className="buybox__note">Must be below {formatMoney(listing.priceCents ?? 0)}.</p>
                  {settleForm('offer-', 'offer')}
                  <button className="secondary" type="submit">Submit offer</button>
                </form>
              )}
            </>
          )}

          <div className="trust">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
              <path
                d="M9 12l2 2 4-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              <strong>You pay the seller directly.</strong> CollectTT never holds your funds —
              cash, transfer, however you agree.
            </span>
          </div>
        </aside>
      </div>

      {isSeller && !isAuction && pendingOffers.length > 0 && (
        <section className="offers-section" aria-labelledby="offers-heading">
          <h2 id="offers-heading" className="section-label">Offers to review</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Offer</th>
                  <th>Fulfillment</th>
                  <th>Received</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pendingOffers.map((offer) => (
                  <tr key={offer.id}>
                    <td>{offer.buyerName}</td>
                    <td className="num"><strong>{formatMoney(offer.amountCents)}</strong></td>
                    <td>{offer.fulfillmentPath.replace('_', ' ')}</td>
                    <td className="muted">{offer.createdAt.toLocaleString('en-TT')}</td>
                    <td>
                      <div className="offer-actions">
                        <form action={acceptOfferAction}>
                          <input type="hidden" name="listingId" value={id} />
                          <input type="hidden" name="offerId" value={offer.id} />
                          <button type="submit">Accept</button>
                        </form>
                        <form action={rejectOfferAction}>
                          <input type="hidden" name="listingId" value={id} />
                          <input type="hidden" name="offerId" value={offer.id} />
                          <button className="secondary" type="submit">Reject</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ bid history */}
      {isAuction && recentBids.length > 0 && (
        <>
          <h2 className="section-label">Bid history</h2>
          <table>
            <thead>
              <tr>
                <th>Bid</th>
                <th>Bidder</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recentBids.map((bid, i) => (
                <tr key={`${bid.amountCents}-${i}`}>
                  <td className="num" style={{ fontWeight: i === 0 ? 700 : 500 }}>
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
          <h2 className="section-label">Description</h2>
          <p className="prose">{listing.description}</p>
        </>
      )}

      {attributeRows.length > 0 && (
        <>
          <h2 className="section-label">{category.label} details</h2>
          <dl className="attrs">
            {attributeRows.map((attr) => {
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
        </>
      )}

      <h2 className="section-label">How this deal can settle</h2>
      <ul className="settle-list">
        {listing.fulfillmentPaths.map((path) => (
          <li key={path}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M5 12l5 5 9-11"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {PATH_LABELS[path] ?? path}
          </li>
        ))}
      </ul>
      <p className="muted" style={{ marginTop: '.85rem' }}>
        Accepted payment: {listing.settlementMethods.join(', ')}. Payment always flows
        directly between buyer and seller — CollectTT never holds funds.
      </p>

      <h2 className="section-label">Seller</h2>
      <div className="seller-card">
        <span className="seller-card__avatar" aria-hidden="true">
          {sellerName.trim().charAt(0).toUpperCase()}
        </span>
        <span>
          <Link className="seller-card__name" href={`/members/${listing.sellerId}`}>
            {sellerName}
          </Link>
          <span className="seller-card__meta">
            Member since {sellerSince.toLocaleDateString('en-TT')}
          </span>
        </span>
      </div>
    </main>
  );
}
