import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { getListing, getListingActivity } from '@/services/listings';
import { candidateStoresFor } from '@/services/relay-stores';
import { categoryDefinitionWithCatalogValues } from '@/services/catalog';
import { formatMoney, minimumNextBid } from '@/domain/money';
import { imageVariants } from '@/services/images';
import { currentUser } from '@/lib/session';
import { db } from '@/db/client';
import { bids, claims } from '@/db/schema/listings';
import { profiles } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { acceptOfferAction, bidAction, cancelOfferAndClaimAction, claimAction, rejectOfferAction, submitOfferAction } from './actions';
import { AuctionLive } from './bid-panel';
import { latestOfferForBuyer, pendingOffersForSeller } from '@/services/offers';
import { trustSnapshotsForMembers } from '@/services/reputation';
import { serializeTrustSnapshot } from '../../deals/buyer-snapshot-data';
import { SignInRequiredModal } from '@/components/sign-in-required-modal';
import { ClaimConfirmedModal } from './claim-confirmed-modal';
import { SettlementFields } from './settlement-fields';
import { BuyerSnapshotLink } from '../../deals/buyer-snapshot-link';

export const dynamic = 'force-dynamic';

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; claimed?: string; bid?: string; offer?: string; auth?: string }>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const result = await getListing(id);
  if (result === null) notFound();

  const { listing, sellerName, sellerSince, images, deliveryOptions, paymentOptions } = result;
  const [category, sellerSnapshots] = await Promise.all([
    categoryDefinitionWithCatalogValues(listing.category),
    trustSnapshotsForMembers(db, [listing.sellerId]),
  ]);
  const sellerSnapshot = sellerSnapshots.get(listing.sellerId) ?? null;
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

  // The viewer's active claim, if any. Historical terminal claims are not shown as
  // an active deal and do not block a later relist.
  const myClaim =
    viewer !== null && !isAuction
      ? (
          await db
            .select()
            .from(claims)
            .where(and(eq(claims.listingId, id), eq(claims.claimantId, viewer.userId), eq(claims.status, 'active')))
            .limit(1)
        )[0]
      : undefined;

  // Never trust `?claimed=1` by itself. The transaction must belong to this viewer
  // and this listing before the success modal is rendered.
  const claimedTransactionId =
    flash.claimed === '1' && viewer !== null && !isSeller && myClaim?.transactionId !== undefined && myClaim.transactionId !== null
      ? (
          await db
            .select({ id: transactions.id })
            .from(transactions)
            .where(
              and(
                eq(transactions.id, myClaim.transactionId),
                eq(transactions.listingId, id),
                eq(transactions.buyerId, viewer.userId),
                inArray(transactions.state, ['open', 'completed']),
              ),
            )
            .limit(1)
        )[0]?.id ?? null
      : null;

  const minBid = minimumNextBid(listing.currentBidCents, listing.startBidCents ?? 0);

  // Candidate stores for the picker — UX filtering only; claimListing re-runs
  // the real gate server-side.
  const relayCandidates = deliveryOptions.some((option) => option.requiresStore)
    ? await candidateStoresFor(db, id)
    : [];

  // Never offer a path the member cannot actually complete. A listing can declare
  // `relay` while every store the seller nominated has since been deactivated.
  const choosableDeliveryOptions = deliveryOptions.filter(
    (option) => !option.requiresStore || relayCandidates.length > 0,
  );
  const paymentWindowDays = Math.ceil(listing.paymentWindowHours / 24);
  const canMakeOffer = !isAuction && viewer !== null && !isSeller && listing.status === 'active' && listing.acceptsOffers;

  const settleForm = (idPrefix: string, fieldPrefix = '') => (
    <SettlementFields
      idPrefix={idPrefix}
      fieldPrefix={fieldPrefix}
      deliveryOptions={choosableDeliveryOptions}
      paymentOptions={paymentOptions}
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
      {claimedTransactionId !== null && (
        <ClaimConfirmedModal transactionId={claimedTransactionId} listingId={id} />
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

            {sellerSnapshot !== null && (
              <section className="listing-detail-card listing-seller-summary" aria-labelledby="seller-snapshot-heading">
                <BuyerSnapshotLink
                  snapshot={serializeTrustSnapshot(sellerSnapshot)}
                  subjectLabel="Seller"
                  triggerClassName="listing-seller-summary__trigger"
                  showTriggerIcon={false}
                  triggerContent={
                    <>
                      <span className="listing-seller-summary__header">
                        <h2 id="seller-snapshot-heading" className="listing-detail-title">Seller</h2>
                        <span className="listing-seller-summary__hint">Click to view trust snapshot</span>
                      </span>
                      <span className="listing-seller-summary__body">
                        <span className="listing-seller-summary__identity">
                          <span className="listing-seller-summary__avatar" aria-hidden="true">
                            {sellerName.trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="listing-seller-summary__identity-copy">
                            <strong className="listing-seller-summary__name">{sellerName}</strong>
                            <span className="listing-seller-summary__meta">
                              Member since {sellerSince.toLocaleDateString('en-TT')}
                            </span>
                          </span>
                        </span>
                        <span className="listing-seller-summary__metric">
                          <strong>{sellerSnapshot.counters.sellCompleted}</strong>
                          <span>Completed sales</span>
                        </span>
                      </span>
                    </>
                  }
                />
              </section>
            )}

            <section className="listing-detail-card listing-settlement-card" aria-label="Settlement options">
              <div className="listing-settlement-panel">
                <h2 id="delivery-heading" className="listing-detail-title">Delivery options</h2>
                {choosableDeliveryOptions.length > 0 ? (
                  <ul className="settle-list">
                    {choosableDeliveryOptions.map((option) => {
                      return (
                        <li key={option.id}>
                          <span className="settle-list__copy">
                            <span className="settle-list__summary">
                              <strong>{option.label}</strong>
                              {option.expectedDeliveryDays !== undefined && (
                                <span className="settle-list__meta">
                                  Expected within {option.expectedDeliveryDays} day{option.expectedDeliveryDays === 1 ? '' : 's'}
                                </span>
                              )}
                            </span>
                            {option.requiresStore && relayCandidates.length > 0 && (
                              <span className="settle-list__locations" aria-label="Pickup Locations">
                                <span className="settle-list__locations-label">Pickup Locations</span>
                                <span className="settle-list__locations-list">
                                  {relayCandidates.map((store) => (
                                    <span className="settle-list__location" key={store.id}>
                                      {store.name} <span className="settle-list__location-area">({store.area})</span>
                                    </span>
                                  ))}
                                </span>
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
                  {paymentOptions.map((option) => (
                    <li key={option.key}>{option.label}</li>
                  ))}
                </ul>
                <div className="listing-settlement-panel__notes">
                  <p>
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
                {listing.status === 'active' && (
                  <form className="buybox__form" action={cancelOfferAndClaimAction}>
                    <input type="hidden" name="listingId" value={id} />
                    <input type="hidden" name="offerId" value={myOffer.id} />
                    <button type="submit">Cancel offer and claim at full price</button>
                  </form>
                )}
              </div>
            </div>
          ) : myClaim !== undefined ? (
            <div className="buybox__state">
              You have claimed this item.
              {myClaim.transactionId !== null && (
                <>
                  {' '}
                  <Link href={`/deals/${myClaim.transactionId}`}>Open the deal →</Link>
                </>
              )}
            </div>
          ) : listing.status === 'active' ? (
            <form className="buybox__form" action={claimAction}>
              <input type="hidden" name="listingId" value={id} />
              {settleForm('')}
              <button type="submit">Claim it</button>
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
                    <td>{deliveryOptions.find((option) => option.id === offer.deliveryOptionId)?.label ?? offer.fulfillmentPath}</td>
                    <td>{offer.settlementMethod === null ? 'Legacy offer' : paymentOptions.find((option) => option.key === offer.settlementMethod)?.label ?? offer.settlementMethod}</td>
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

    </main>
  );
}
