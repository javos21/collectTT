import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { getListing, getListingActivity } from '@/services/listings';
import { candidateStoresFor } from '@/services/relay-stores';
import { getCategory } from '@/domain/categories/definitions';
import { formatMoney, minimumNextBid } from '@/domain/money';
import { SETTLEMENT_METHOD_LABELS } from '@/domain/policy/settlement';
import { imageVariants } from '@/services/images';
import { currentUser } from '@/lib/session';
import { db } from '@/db/client';
import { bids, claims } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { acceptOfferAction, bidAction, cancelOfferAndClaimAction, claimAction, rejectOfferAction, submitOfferAction } from './actions';
import { AuctionLive } from './bid-panel';
import { latestOfferForBuyer, pendingOffersForSeller } from '@/services/offers';
import { SignInRequiredModal } from '@/components/sign-in-required-modal';
import { QueueJoinedModal } from './queue-joined-modal';
import { SettlementFields } from './settlement-fields';

export const dynamic = 'force-dynamic';

const DELIVERY_LABELS: Record<string, string> = {
  cash_meetup: 'Meet in person',
  remote_ship: 'Seller ships to you',
  relay: 'Pick up at a store',
  full_service: 'CollectTT delivery',
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

  const { listing, sellerName, sellerSince, images, fulfillmentTerms } = result;
  const category = getCategory(listing.category);
  const attributes = listing.attributes as Record<string, unknown>;
  const viewer = await currentUser();
  const showSignInModal = viewer === null && flash.auth === 'buy';
  const isSeller = viewer?.userId === listing.sellerId;
  const sellerActivity = isSeller ? await getListingActivity(id) : null;
  const pendingOffers = isSeller && listing.saleType === 'straight_sale'
    ? await pendingOffersForSeller(id, viewer.userId)
    : [];
  const myOffer = viewer !== null && !isSeller && listing.saleType === 'straight_sale'
    ? await latestOfferForBuyer(id, viewer.userId)
    : null;

  const isAuction = listing.saleType === 'auction';
  const isOpen = listing.status === 'active';
  const sellerQueue = isSeller && !isAuction
    ? await db
        .select({
          position: claims.position,
          status: claims.status,
          claimantName: profiles.displayName,
          claimedAt: claims.claimedAt,
        })
        .from(claims)
        .innerJoin(profiles, eq(profiles.userId, claims.claimantId))
        .where(and(eq(claims.listingId, id), inArray(claims.status, ['active', 'queued', 'promoted'])))
        .orderBy(asc(claims.position))
    : [];

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
    ? (await db
        .select({ id: claims.id })
        .from(claims)
        .where(and(eq(claims.listingId, id), inArray(claims.status, ['active', 'queued', 'promoted'])))).length
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
  //   picker renders, and choosing "Pick up at a store" is refused only AFTER the
  //   form is submitted. Both the bid form and the claim form read this list.
  const choosablePaths = listing.fulfillmentPaths.filter(
    (path) => path !== 'relay' || relayCandidates.length > 0,
  );
  const paymentWindowDays = Math.ceil(listing.paymentWindowHours / 24);
  const canMakeOffer = !isAuction && viewer !== null && !isSeller && listing.status === 'active' && listing.acceptsOffers;

  const settleForm = (idPrefix: string, fieldPrefix = '') => (
    <SettlementFields
      idPrefix={idPrefix}
      fieldPrefix={fieldPrefix}
      paths={choosablePaths}
      pathLabels={DELIVERY_LABELS}
      paymentMethods={listing.settlementMethods}
      paymentLabels={SETTLEMENT_METHOD_LABELS}
      relayCandidates={relayCandidates}
    />
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
        <QueueJoinedModal position={flash.queued} listingId={id} />
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
        <div className="listing-main">
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

          <div className="listing-details">
            {listing.description !== null && listing.description !== '' && (
              <section className="listing-detail-card" aria-labelledby="description-heading">
                <h2 id="description-heading" className="listing-detail-title">Description</h2>
                <p className="prose">{listing.description}</p>
              </section>
            )}

            <section className="listing-detail-card listing-settlement-card" aria-label="Settlement options">
              <div className="listing-settlement-panel">
                <h2 id="delivery-heading" className="listing-detail-title">Delivery options</h2>
                {choosablePaths.length > 0 ? (
                  <ul className="settle-list">
                    {choosablePaths.map((path) => {
                      const term = fulfillmentTerms.find((item) => item.fulfillmentPath === path);
                      return (
                        <li key={path}>
                          <span className="settle-list__copy">
                            <strong>{DELIVERY_LABELS[path] ?? path}</strong>
                            {term !== undefined && (
                              <span className="settle-list__meta">
                                Expected within {term.expectedDeliveryDays} day{term.expectedDeliveryDays === 1 ? '' : 's'}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="buybox__note">No delivery options are currently available for this item.</p>
                )}
              </div>
              <div className="listing-settlement-panel">
                <h2 id="payment-heading" className="listing-detail-title">Payment options</h2>
                <ul className="payment-options-list" aria-label="Accepted payment methods">
                  {listing.settlementMethods.map((method) => (
                    <li key={method}>{SETTLEMENT_METHOD_LABELS[method as keyof typeof SETTLEMENT_METHOD_LABELS] ?? method}</li>
                  ))}
                </ul>
                <div className="listing-settlement-panel__notes">
                  <p>
                    <strong>Payment is made directly between buyer and seller.</strong>
                    <strong>
                      Payment is expected within {paymentWindowDays} day{paymentWindowDays === 1 ? '' : 's'} after a deal opens.
                    </strong>
                  </p>
                </div>
              </div>
            </section>

            <section className="listing-detail-card" aria-labelledby="listing-details-heading">
              <h2 id="listing-details-heading" className="listing-detail-title">Listing details</h2>
              <dl className="attrs">
                <div className="attrs__item">
                  <dt>Category</dt>
                  <dd>{category.label}</dd>
                </div>
                <div className="attrs__item">
                  <dt>Sale type</dt>
                  <dd>{isAuction ? 'Auction' : 'Straight sale'}</dd>
                </div>
              </dl>
            </section>

            {attributeRows.length > 0 && (
              <section className="listing-detail-card" aria-labelledby="attributes-heading">
                <h2 id="attributes-heading" className="listing-detail-title">{category.label} details</h2>
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
                      <div className="attrs__item" key={attr.key}>
                        <dt>{attr.label}</dt>
                        <dd>{display}</dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            )}
          </div>
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
            <>
              <div className="buybox__owner-notice">
                <strong>This is your listing.</strong>
                {!sellerActivity?.locked && (listing.status === 'active' || listing.status === 'draft') && (
                  <Link
                    className="buybox__edit-link"
                    href={`/listings/${id}/edit`}
                    aria-label="Edit listing"
                    title="Edit listing"
                  >
                    <Pencil aria-hidden="true" />
                  </Link>
                )}
              </div>
              {pendingOffers.length > 0 && (
                <p className="buybox__owner-detail">
                  {pendingOffers.length} offer{pendingOffers.length === 1 ? '' : 's'} waiting.
                </p>
              )}
              {sellerActivity?.locked && (
                <p className="buybox__lock-note">
                  Editing and cancellation are locked while buyer activity is active.
                </p>
              )}
            </>
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
          ) : myOffer?.status === 'pending' ? (
            <div className="buybox__pending-offer">
              <div className="buybox__state">
                Your offer of <strong>{formatMoney(myOffer.amountCents)}</strong> is waiting for the seller.
                <p className="buybox__note">
                  Cancel the offer if you want to buy this item at the asking price.
                </p>
                {(listing.status === 'active' || (listing.status === 'claimed' && stackDepth < 3)) && (
                  <form className="buybox__form" action={cancelOfferAndClaimAction}>
                    <input type="hidden" name="listingId" value={id} />
                    <input type="hidden" name="offerId" value={myOffer.id} />
                    <button type="submit">
                      {listing.status === 'active'
                        ? 'Cancel offer and claim at full price'
                        : 'Cancel offer and join the backup queue'}
                    </button>
                  </form>
                )}
              </div>
            </div>
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
          ) : listing.status === 'active' || (listing.status === 'claimed' && stackDepth < 3) ? (
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
              {canMakeOffer && (
                <div className="buybox__offer-wrap">
                  <hr />
                  <details className="buybox__offer-disclosure">
                    <summary>Make an offer</summary>
                    <div className="buybox__offer-fields">
                      <label htmlFor="offerAmount">Your offer</label>
                      <input
                        id="offerAmount"
                        name="offerAmount"
                        type="text"
                        inputMode="decimal"
                        placeholder={(Math.max(1, (listing.priceCents ?? 1) - 1) / 100).toFixed(2)}
                      />
                      <button className="secondary" type="submit" formAction={submitOfferAction}>Submit offer</button>
                    </div>
                  </details>
                </div>
              )}
            </form>
          ) : (
            <div className="buybox__state">This listing is no longer available for new claims.</div>
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

          <div className="buybox__details">
            <section className="buybox__section" aria-labelledby="seller-heading">
              <h2 id="seller-heading" className="buybox__section-title">Seller</h2>
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
            </section>
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
                  <th>Delivery</th>
                  <th>Payment</th>
                  <th>Received</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pendingOffers.map((offer) => (
                  <tr key={offer.id}>
                    <td>{offer.buyerName}</td>
                    <td className="num"><strong>{formatMoney(offer.amountCents)}</strong></td>
                    <td>{DELIVERY_LABELS[offer.fulfillmentPath] ?? offer.fulfillmentPath}</td>
                    <td>{offer.settlementMethod === null ? 'Legacy offer' : SETTLEMENT_METHOD_LABELS[offer.settlementMethod as keyof typeof SETTLEMENT_METHOD_LABELS] ?? offer.settlementMethod}</td>
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

      {isSeller && !isAuction && sellerQueue.length > 0 && (
        <section className="offers-section" aria-labelledby="claim-queue-heading">
          <h2 id="claim-queue-heading" className="section-label">Claim queue</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Priority</th><th>Buyer</th><th>Status</th><th>Claimed</th></tr></thead>
              <tbody>
                {sellerQueue.map((claim) => (
                  <tr key={`${claim.position}-${claim.claimedAt.toISOString()}`}>
                    <td><strong>#{claim.position}</strong></td>
                    <td>{claim.claimantName}</td>
                    <td>{claim.status === 'active' ? 'First claim in progress' : 'Backup queue'}</td>
                    <td className="muted">{claim.claimedAt.toLocaleString('en-TT')}</td>
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

    </main>
  );
}
