import Link from 'next/link';
import { asc, desc, eq } from 'drizzle-orm';
import { ArrowLeft, CircleDollarSign, ClipboardList, Gavel, History, ImageIcon, ListChecks, Tags, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { bids, claims, categories, listingAuditEvents, listingImages, listings } from '@/db/schema/listings';
import { images } from '@/db/schema/images';
import { offers } from '@/db/schema/offers';
import { profiles } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { formatMoney } from '@/domain/money';
import { requireAdmin } from '@/lib/admin';
import { AdminFrame } from '../../admin-frame';

function dateTime(value: Date | null): string {
  return value === null ? '—' : value.toLocaleString('en-TT', { dateStyle: 'medium', timeStyle: 'short' });
}

function label(value: string | null): string {
  return value === null ? '—' : value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): string {
  if (status === 'active' || status === 'completed' || status === 'accepted' || status === 'won') return 'active';
  if (status === 'cancelled' || status === 'expired' || status === 'rejected' || status === 'void' || status === 'reneged') return 'declined';
  if (status === 'claimed' || status === 'pending' || status === 'open' || status === 'confirmed') return 'confirmed';
  return 'ended';
}

function money(cents: number | null, currency: string): string {
  return cents === null ? '—' : formatMoney(cents, currency === 'USD' ? 'USD' : 'TTD');
}

function fileSize(bytes: number | null): string {
  if (bytes === null) return 'Size unavailable';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/listings/${encodeURIComponent(id)}`);

  const listingRows = await db
    .select({
      listing: listings,
      sellerName: profiles.displayName,
      sellerHandle: profiles.handle,
      sellerSince: profiles.memberSince,
      sellerEmail: users.email,
      categoryLabel: categories.label,
    })
    .from(listings)
    .innerJoin(profiles, eq(profiles.userId, listings.sellerId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .innerJoin(categories, eq(categories.key, listings.category))
    .where(eq(listings.id, id))
    .limit(1);

  const row = listingRows[0];
  if (row === undefined) notFound();
  const listing = row.listing;

  const [imageRows, claimRows, bidRows, offerRows, auditRows, transactionRows] = await Promise.all([
    db
      .select({
        id: images.id,
        position: listingImages.position,
        status: images.status,
        contentType: images.contentType,
        bytes: images.bytes,
        width: images.width,
        height: images.height,
      })
      .from(listingImages)
      .innerJoin(images, eq(images.id, listingImages.imageId))
      .where(eq(listingImages.listingId, id))
      .orderBy(asc(listingImages.position)),
    db
      .select({
        id: claims.id,
        claimantId: profiles.userId,
        claimantName: profiles.displayName,
        claimantHandle: profiles.handle,
        position: claims.position,
        status: claims.status,
        fulfillmentPath: claims.fulfillmentPath,
        settlementMethod: claims.settlementMethod,
        transactionId: claims.transactionId,
        claimedAt: claims.claimedAt,
      })
      .from(claims)
      .innerJoin(profiles, eq(profiles.userId, claims.claimantId))
      .where(eq(claims.listingId, id))
      .orderBy(desc(claims.claimedAt)),
    db
      .select({
        id: bids.id,
        bidderId: profiles.userId,
        bidderName: profiles.displayName,
        bidderHandle: profiles.handle,
        amountCents: bids.amountCents,
        isBuyout: bids.isBuyout,
        status: bids.status,
        placedAt: bids.placedAt,
      })
      .from(bids)
      .innerJoin(profiles, eq(profiles.userId, bids.bidderId))
      .where(eq(bids.listingId, id))
      .orderBy(desc(bids.amountCents), desc(bids.placedAt)),
    db
      .select({
        id: offers.id,
        buyerId: profiles.userId,
        buyerName: profiles.displayName,
        buyerHandle: profiles.handle,
        amountCents: offers.amountCents,
        status: offers.status,
        respondedAt: offers.respondedAt,
        createdAt: offers.createdAt,
      })
      .from(offers)
      .innerJoin(profiles, eq(profiles.userId, offers.buyerId))
      .where(eq(offers.listingId, id))
      .orderBy(desc(offers.createdAt)),
    db
      .select({
        id: listingAuditEvents.id,
        eventType: listingAuditEvents.eventType,
        metadata: listingAuditEvents.metadata,
        occurredAt: listingAuditEvents.occurredAt,
        actorName: profiles.displayName,
        actorHandle: profiles.handle,
      })
      .from(listingAuditEvents)
      .leftJoin(profiles, eq(profiles.userId, listingAuditEvents.actorUserId))
      .where(eq(listingAuditEvents.listingId, id))
      .orderBy(desc(listingAuditEvents.occurredAt)),
    db
      .select({
        id: transactions.id,
        buyerId: transactions.buyerId,
        sellerId: transactions.sellerId,
        amountCents: transactions.amountCents,
        state: transactions.state,
        paymentState: transactions.paymentState,
        custodyState: transactions.custodyState,
        attemptNumber: transactions.attemptNumber,
        createdAt: transactions.createdAt,
        updatedAt: transactions.updatedAt,
      })
      .from(transactions)
      .where(eq(transactions.listingId, id))
      .orderBy(desc(transactions.attemptNumber), desc(transactions.createdAt)),
  ]);

  const listingAmount = listing.saleType === 'auction' ? listing.currentBidCents ?? listing.startBidCents : listing.priceCents;
  const attributes = JSON.stringify(listing.attributes, null, 2);

  return (
    <AdminFrame activeNav="listings">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading admin-heading--detail">
          <div>
            <Link className="admin-back-link" href="/admin/listings"><ArrowLeft size={15} aria-hidden="true" />Listing directory</Link>
            <p className="admin-kicker">Listing detail</p>
            <h1>{listing.title}</h1>
            <p>{row.categoryLabel} · {label(listing.saleType)} · Created {dateTime(listing.createdAt)}</p>
          </div>
          <span className={`admin-status admin-status--${statusTone(listing.status)}`}>{label(listing.status)}</span>
        </div>

        <section className="admin-stats admin-listing-stats" aria-label="Listing summary">
          <article className="admin-stat admin-stat--purple"><div className="admin-stat__icon"><CircleDollarSign size={19} aria-hidden="true" /></div><div><strong>{money(listingAmount, listing.currency)}</strong><span>{listing.saleType === 'auction' ? 'Current bid' : 'Asking price'}</span></div></article>
          <article className="admin-stat admin-stat--blue"><div className="admin-stat__icon"><ImageIcon size={19} aria-hidden="true" /></div><div><strong>{imageRows.length}</strong><span>Images</span></div></article>
          <article className="admin-stat admin-stat--green"><div className="admin-stat__icon"><Gavel size={19} aria-hidden="true" /></div><div><strong>{bidRows.length}</strong><span>Bids</span></div></article>
          <article className="admin-stat admin-stat--amber"><div className="admin-stat__icon"><ListChecks size={19} aria-hidden="true" /></div><div><strong>{claimRows.length + offerRows.length}</strong><span>Claims and offers</span></div></article>
        </section>

        <div className="admin-detail-grid">
          <section className="admin-panel" aria-labelledby="listing-context-title">
            <div className="admin-panel__heading"><div><h2 id="listing-context-title">Listing context</h2><p className="admin-panel__subcopy">Current state and seller-declared terms.</p></div><ClipboardList size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Listing ID</dt><dd><code>{listing.id}</code></dd></div>
              <div><dt>Category</dt><dd>{row.categoryLabel}<small>Schema version {listing.attributesVersion}</small></dd></div>
              <div><dt>Status</dt><dd><span className={`admin-status admin-status--${statusTone(listing.status)}`}>{label(listing.status)}</span></dd></div>
              <div><dt>Amount</dt><dd>{money(listingAmount, listing.currency)}<small>{listing.currency} · {listing.acceptsOffers ? 'Offers accepted' : 'Offers not accepted'}</small></dd></div>
              <div><dt>Published</dt><dd>{dateTime(listing.publishedAt)}</dd></div>
              <div><dt>Resolves / ends</dt><dd>{dateTime(listing.resolvedAt ?? listing.endsAt)}</dd></div>
              <div><dt>Fulfillment</dt><dd>{listing.fulfillmentPaths.map(label).join(', ') || '—'}</dd></div>
              <div><dt>Settlement</dt><dd>{listing.settlementMethods.map(label).join(', ') || '—'}</dd></div>
            </dl>
          </section>

          <section className="admin-panel" aria-labelledby="listing-seller-title">
            <div className="admin-panel__heading"><div><h2 id="listing-seller-title">Seller</h2><p className="admin-panel__subcopy">Seller context for support review.</p></div><UserRound size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Member</dt><dd><Link href={`/admin/members/${encodeURIComponent(listing.sellerId)}`}><UserRound size={14} aria-hidden="true" />{row.sellerName}</Link><small>@{row.sellerHandle}</small></dd></div>
              <div><dt>Email</dt><dd><a href={`mailto:${row.sellerEmail}`}>{row.sellerEmail}</a></dd></div>
              <div><dt>Member since</dt><dd>{dateTime(row.sellerSince)}</dd></div>
              <div><dt>Open transaction</dt><dd>{listing.activeTransactionId === null ? 'None recorded' : <code>{listing.activeTransactionId}</code>}</dd></div>
            </dl>
          </section>
        </div>

        <section className="admin-panel admin-detail-section" aria-labelledby="listing-description-title">
          <div className="admin-panel__heading"><div><h2 id="listing-description-title">Description and attributes</h2><p className="admin-panel__subcopy">Seller-provided listing content, preserved for moderation context.</p></div><Tags size={19} aria-hidden="true" /></div>
          {listing.description !== null && <p className="admin-detail-note">{listing.description}</p>}
          <pre className="admin-json-block"><code>{attributes}</code></pre>
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="listing-images-title">
          <div className="admin-panel__heading"><div><h2 id="listing-images-title">Images</h2><p className="admin-panel__subcopy">Image processing state and attached previews.</p></div><ImageIcon size={19} aria-hidden="true" /></div>
          {imageRows.length === 0 ? <p className="admin-empty-copy">No images are attached to this listing.</p> : <div className="admin-listing-image-grid">{imageRows.map((image) => <article className="admin-listing-image-card" key={image.id}>{image.status === 'ready' ? <img src={`/api/images/${image.id}?variant=card`} alt={`${listing.title} image ${image.position + 1}`} /> : <div className="admin-listing-image-placeholder"><ImageIcon size={22} aria-hidden="true" /><span>{label(image.status)}</span></div>}<div><strong>Image {image.position + 1}</strong><small>{image.contentType ?? 'Type unavailable'} · {fileSize(image.bytes)}</small><small>{image.width !== null && image.height !== null ? `${image.width} × ${image.height}` : 'Dimensions unavailable'} · {image.id}</small></div></article>)}</div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="listing-claims-title">
          <div className="admin-panel__heading"><div><h2 id="listing-claims-title">Claims</h2><p className="admin-panel__subcopy">Fixed-price claim history and transaction linkage.</p></div><ListChecks size={19} aria-hidden="true" /></div>
          {claimRows.length === 0 ? <p className="admin-empty-copy">No claims recorded.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Listing claims</caption><thead><tr><th scope="col">Claimant</th><th scope="col">Position</th><th scope="col">Status</th><th scope="col">Fulfillment</th><th scope="col">Settlement</th><th scope="col">Claimed</th><th scope="col">Transaction</th></tr></thead><tbody>{claimRows.map((claim) => <tr key={claim.id}><th scope="row"><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(claim.claimantId)}`}>{claim.claimantName}</Link><small>@{claim.claimantHandle}</small></th><td>{claim.position}</td><td><span className={`admin-status admin-status--${statusTone(claim.status)}`}>{label(claim.status)}</span></td><td>{label(claim.fulfillmentPath)}</td><td>{label(claim.settlementMethod)}</td><td>{dateTime(claim.claimedAt)}</td><td><code>{claim.transactionId ?? '—'}</code></td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="listing-bids-title">
          <div className="admin-panel__heading"><div><h2 id="listing-bids-title">Bids</h2><p className="admin-panel__subcopy">Auction ladder with bidder and outcome context.</p></div><Gavel size={19} aria-hidden="true" /></div>
          {bidRows.length === 0 ? <p className="admin-empty-copy">No bids recorded.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Listing bids</caption><thead><tr><th scope="col">Bidder</th><th scope="col">Amount</th><th scope="col">State</th><th scope="col">Type</th><th scope="col">Placed</th></tr></thead><tbody>{bidRows.map((bid) => <tr key={bid.id}><th scope="row"><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(bid.bidderId)}`}>{bid.bidderName}</Link><small>@{bid.bidderHandle}</small></th><td>{money(bid.amountCents, listing.currency)}</td><td><span className={`admin-status admin-status--${statusTone(bid.status)}`}>{label(bid.status)}</span></td><td>{bid.isBuyout ? 'Buyout' : 'Standard bid'}</td><td>{dateTime(bid.placedAt)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="listing-offers-title">
          <div className="admin-panel__heading"><div><h2 id="listing-offers-title">Offers</h2><p className="admin-panel__subcopy">Negotiation history for fixed-price inventory.</p></div><CircleDollarSign size={19} aria-hidden="true" /></div>
          {offerRows.length === 0 ? <p className="admin-empty-copy">No offers recorded.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Listing offers</caption><thead><tr><th scope="col">Buyer</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Responded</th></tr></thead><tbody>{offerRows.map((offer) => <tr key={offer.id}><th scope="row"><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(offer.buyerId)}`}>{offer.buyerName}</Link><small>@{offer.buyerHandle}</small></th><td>{money(offer.amountCents, listing.currency)}</td><td><span className={`admin-status admin-status--${statusTone(offer.status)}`}>{label(offer.status)}</span></td><td>{dateTime(offer.createdAt)}</td><td>{dateTime(offer.respondedAt)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="listing-transactions-title">
          <div className="admin-panel__heading"><div><h2 id="listing-transactions-title">Deal attempts</h2><p className="admin-panel__subcopy">Transaction state is shown without exposing admin actions in this slice.</p></div><ClipboardList size={19} aria-hidden="true" /></div>
          {transactionRows.length === 0 ? <p className="admin-empty-copy">No deal attempts recorded.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Listing transaction attempts</caption><thead><tr><th scope="col">Attempt</th><th scope="col">Amount</th><th scope="col">State</th><th scope="col">Payment</th><th scope="col">Custody</th><th scope="col">Created</th><th scope="col">Updated</th></tr></thead><tbody>{transactionRows.map((transaction) => <tr key={transaction.id}><th scope="row"><code>{transaction.id}</code><small>{transaction.buyerId === listing.sellerId ? 'Buyer data unavailable' : `Buyer ${transaction.buyerId}`}</small></th><td>{money(transaction.amountCents, listing.currency)}</td><td><span className={`admin-status admin-status--${statusTone(transaction.state)}`}>{label(transaction.state)}</span></td><td>{label(transaction.paymentState)}</td><td>{label(transaction.custodyState)}</td><td>{dateTime(transaction.createdAt)}</td><td>{dateTime(transaction.updatedAt)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="listing-audit-title">
          <div className="admin-panel__heading"><div><h2 id="listing-audit-title">Listing audit history</h2><p className="admin-panel__subcopy">Append-only listing events for support and future moderation review.</p></div><History size={19} aria-hidden="true" /></div>
          {auditRows.length === 0 ? <p className="admin-empty-copy">No listing audit events recorded.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Listing audit history</caption><thead><tr><th scope="col">Event</th><th scope="col">Actor</th><th scope="col">Occurred</th><th scope="col">Metadata</th></tr></thead><tbody>{auditRows.map((event) => <tr key={event.id}><th scope="row">{label(event.eventType)}</th><td>{event.actorName === null ? 'System' : <>{event.actorName}<small>@{event.actorHandle}</small></>}</td><td>{dateTime(event.occurredAt)}</td><td><pre className="admin-audit-meta">{JSON.stringify(event.metadata)}</pre></td></tr>)}</tbody></table></div>}
        </section>
      </main>
    </AdminFrame>
  );
}
