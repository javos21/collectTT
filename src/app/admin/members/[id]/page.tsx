import Link from 'next/link';
import { desc, eq, or } from 'drizzle-orm';
import { ArrowLeft, BadgeCheck, BriefcaseBusiness, CircleAlert, Gavel, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { accounts, users } from '@/db/schema/auth';
import { listings } from '@/db/schema/listings';
import { restrictions, reputationCounters, profiles } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { formatMoney } from '@/domain/money';
import { requireAdmin } from '@/lib/admin';
import { AdminFrame } from '../../admin-frame';
import { LiftRestrictionForm, MemberAdminActions } from '../member-actions';

function date(value: Date | null): string {
  return value === null ? '—' : value.toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateTime(value: Date | null): string {
  return value === null ? '—' : value.toLocaleString('en-TT', { dateStyle: 'medium', timeStyle: 'short' });
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string): string {
  if (status === 'active' || status === 'completed' || status === 'confirmed') return 'active';
  if (status === 'suspended' || status === 'banned' || status === 'restricted' || status === 'failed') return 'declined';
  if (status === 'open' || status === 'pending' || status === 'draft') return 'pending';
  return 'ended';
}

function listingAmount(listing: { saleType: string; priceCents: number | null; currentBidCents: number | null; startBidCents: number | null }): string {
  const cents = listing.saleType === 'auction'
    ? listing.currentBidCents ?? listing.startBidCents
    : listing.priceCents;
  return cents === null ? '—' : formatMoney(cents);
}

function isActiveRestriction(restriction: { liftedAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
  return restriction.liftedAt === null && (restriction.expiresAt === null || restriction.expiresAt > now);
}

export default async function AdminMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adminSuccess?: string; adminError?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  await requireAdmin(`/admin/members/${encodeURIComponent(id)}`);

  const memberRows = await db
    .select({
      userId: profiles.userId,
      displayName: profiles.displayName,
      handle: profiles.handle,
      phoneE164: profiles.phoneE164,
      phoneVerifiedAt: profiles.phoneVerifiedAt,
      bio: profiles.bio,
      area: profiles.area,
      role: profiles.role,
      status: profiles.status,
      memberSince: profiles.memberSince,
      email: users.email,
      emailVerified: users.emailVerified,
      authCreatedAt: users.createdAt,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, id))
    .limit(1);

  const member = memberRows[0];
  if (member === undefined) notFound();

  const [counterRows, accountRows, restrictionRows, listingRows, dealRows] = await Promise.all([
    db.select().from(reputationCounters).where(eq(reputationCounters.userId, id)).limit(1),
    db.select({ providerId: accounts.providerId }).from(accounts).where(eq(accounts.userId, id)).orderBy(desc(accounts.createdAt)),
    db.select().from(restrictions).where(eq(restrictions.userId, id)).orderBy(desc(restrictions.createdAt)).limit(20),
    db
      .select({
        id: listings.id,
        title: listings.title,
        saleType: listings.saleType,
        status: listings.status,
        priceCents: listings.priceCents,
        currentBidCents: listings.currentBidCents,
        startBidCents: listings.startBidCents,
        createdAt: listings.createdAt,
      })
      .from(listings)
      .where(eq(listings.sellerId, id))
      .orderBy(desc(listings.createdAt))
      .limit(20),
    db
      .select({
        id: transactions.id,
        title: listings.title,
        buyerId: transactions.buyerId,
        sellerId: transactions.sellerId,
        amountCents: transactions.amountCents,
        state: transactions.state,
        paymentState: transactions.paymentState,
        custodyState: transactions.custodyState,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .innerJoin(listings, eq(listings.id, transactions.listingId))
      .where(or(eq(transactions.buyerId, id), eq(transactions.sellerId, id)))
      .orderBy(desc(transactions.createdAt))
      .limit(20),
  ]);

  const counters = counterRows[0];
  const now = new Date();
  const activeRestrictions = restrictionRows.filter((restriction) => isActiveRestriction(restriction, now));
  const accountProviders = [...new Set(accountRows.map((account) => account.providerId))];
  const completedDeals = (counters?.buyCompleted ?? 0) + (counters?.sellCompleted ?? 0);

  return (
    <AdminFrame activeNav="members">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading admin-heading--detail">
          <div>
            <Link className="admin-back-link" href="/admin/members"><ArrowLeft size={15} aria-hidden="true" />Member directory</Link>
            <p className="admin-kicker">Member detail</p>
            <h1>{member.displayName}</h1>
            <p>@{member.handle} · Joined {date(member.memberSince)}</p>
          </div>
          <span className={`admin-status admin-status--${statusTone(member.status)}`}>{label(member.status)}</span>
        </div>

        <section className="admin-stats admin-member-stats" aria-label="Member summary">
          <article className="admin-stat admin-stat--purple"><div className="admin-stat__icon"><BadgeCheck size={19} aria-hidden="true" /></div><div><strong>{completedDeals}</strong><span>Completed deals</span></div></article>
          <article className="admin-stat admin-stat--blue"><div className="admin-stat__icon"><BriefcaseBusiness size={19} aria-hidden="true" /></div><div><strong>{listingRows.length}</strong><span>Recent listings</span></div></article>
          <article className="admin-stat admin-stat--green"><div className="admin-stat__icon"><Gavel size={19} aria-hidden="true" /></div><div><strong>{dealRows.length}</strong><span>Recent deals</span></div></article>
          <article className="admin-stat admin-stat--amber"><div className="admin-stat__icon"><CircleAlert size={19} aria-hidden="true" /></div><div><strong>{activeRestrictions.length}</strong><span>Active restrictions</span></div></article>
        </section>

        <div className="admin-detail-grid">
          <section className="admin-panel" aria-labelledby="member-account-title">
            <div className="admin-panel__heading"><div><h2 id="member-account-title">Account context</h2><p className="admin-panel__subcopy">Information available to platform support.</p></div><UserRound size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Email</dt><dd><a href={`mailto:${member.email}`}><Mail size={14} aria-hidden="true" />{member.email}</a><small>{member.emailVerified ? 'Verified' : 'Not verified'}</small></dd></div>
              <div><dt>Role</dt><dd><span className="admin-status admin-status--draft">{label(member.role)}</span></dd></div>
              <div><dt>Account created</dt><dd>{dateTime(member.authCreatedAt)}</dd></div>
              <div><dt>Sign-in providers</dt><dd>{accountProviders.length === 0 ? 'Not available' : accountProviders.map(label).join(', ')}</dd></div>
              <div><dt>Phone</dt><dd>{member.phoneE164 ?? 'Not supplied'}{member.phoneVerifiedAt !== null && <small>Verified {date(member.phoneVerifiedAt)}</small>}</dd></div>
              <div><dt>Area</dt><dd>{member.area ?? 'Not supplied'}</dd></div>
            </dl>
            {member.bio !== null && <p className="admin-detail-note">{member.bio}</p>}
          </section>

          <section className="admin-panel" aria-labelledby="member-trust-title">
            <div className="admin-panel__heading"><div><h2 id="member-trust-title">Trust snapshot</h2><p className="admin-panel__subcopy">Objective counters only; no admin adjustments in this slice.</p></div><ShieldCheck size={19} aria-hidden="true" /></div>
            <dl className="admin-metric-list">
              <div><dt>Purchases completed</dt><dd>{counters?.buyCompleted ?? 0}</dd></div>
              <div><dt>Sales completed</dt><dd>{counters?.sellCompleted ?? 0}</dd></div>
              <div><dt>Paid on time</dt><dd>{counters?.buyPaidOnTime ?? 0} / {counters?.buyClaimsTotal ?? 0}</dd></div>
              <div><dt>Buyer reneges</dt><dd>{counters?.buyRenegedTotal ?? 0}</dd></div>
              <div><dt>Seller reneges</dt><dd>{counters?.sellRenegedTotal ?? 0}</dd></div>
            </dl>
          </section>
        </div>

        <section className="admin-panel admin-detail-section" aria-labelledby="member-actions-title">
          <div className="admin-panel__heading"><div><h2 id="member-actions-title">Admin actions</h2><p className="admin-panel__subcopy">Every status or restriction change requires a reason and creates an append-only audit record.</p></div><ShieldCheck size={19} aria-hidden="true" /></div>
          {feedback.adminSuccess !== undefined && <p className="admin-form-success" role="status">{feedback.adminSuccess}</p>}
          {feedback.adminError !== undefined && <p className="admin-form-error" role="alert">{feedback.adminError}</p>}
          <MemberAdminActions memberId={member.userId} status={member.status} role={member.role} />
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="member-restrictions-title">
          <div className="admin-panel__heading"><div><h2 id="member-restrictions-title">Restrictions</h2><p className="admin-panel__subcopy">Automatic restrictions are derived from reputation; admin restrictions can be lifted with a reason.</p></div><CircleAlert size={19} aria-hidden="true" /></div>
          {restrictionRows.length === 0 ? <p className="admin-empty-copy">No restrictions recorded.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Member restrictions</caption><thead><tr><th scope="col">Type</th><th scope="col">Source</th><th scope="col">Reason</th><th scope="col">Effective</th><th scope="col">Ends</th><th scope="col">State</th><th scope="col">Action</th></tr></thead><tbody>{restrictionRows.map((restriction) => { const active = isActiveRestriction(restriction, now); return <tr key={restriction.id}><th scope="row">{label(restriction.type)}</th><td>{label(restriction.source)}</td><td>{restriction.reason}</td><td>{dateTime(restriction.effectiveFrom)}</td><td>{dateTime(restriction.expiresAt)}</td><td><span className={`admin-status admin-status--${active ? 'declined' : 'ended'}`}>{active ? 'Active' : restriction.liftedAt !== null ? 'Lifted' : 'Expired'}</span></td><td>{restriction.source === 'admin' && restriction.liftedAt === null ? <LiftRestrictionForm memberId={member.userId} restrictionId={restriction.id} /> : <span className="admin-muted-action">System-controlled</span>}</td></tr>; })}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="member-listings-title">
          <div className="admin-panel__heading"><div><h2 id="member-listings-title">Recent listings</h2><p className="admin-panel__subcopy">Latest inventory owned by this member.</p></div><BriefcaseBusiness size={19} aria-hidden="true" /></div>
          {listingRows.length === 0 ? <p className="admin-empty-copy">This member has not created any listings.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Recent member listings</caption><thead><tr><th scope="col">Listing</th><th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead><tbody>{listingRows.map((listing) => <tr key={listing.id}><th scope="row"><Link className="admin-row-link" href={`/listings/${listing.id}`}>{listing.title}</Link><small>{listing.id}</small></th><td>{label(listing.saleType)}</td><td>{listingAmount(listing)}</td><td><span className={`admin-status admin-status--${statusTone(listing.status)}`}>{label(listing.status)}</span></td><td>{date(listing.createdAt)}</td></tr>)}</tbody></table></div>}
        </section>

        <section className="admin-panel admin-detail-section" aria-labelledby="member-deals-title">
          <div className="admin-panel__heading"><div><h2 id="member-deals-title">Recent deals</h2><p className="admin-panel__subcopy">Transaction context for support triage.</p></div><Gavel size={19} aria-hidden="true" /></div>
          {dealRows.length === 0 ? <p className="admin-empty-copy">This member has no recorded deals.</p> : <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Recent member deals</caption><thead><tr><th scope="col">Deal</th><th scope="col">Role</th><th scope="col">Amount</th><th scope="col">State</th><th scope="col">Payment</th><th scope="col">Started</th></tr></thead><tbody>{dealRows.map((deal) => <tr key={deal.id}><th scope="row"><Link className="admin-row-link" href={`/admin/deals?transaction=${encodeURIComponent(deal.id)}`}>{deal.title}</Link><small>{deal.id}</small></th><td>{deal.buyerId === id ? 'Buyer' : deal.sellerId === id ? 'Seller' : '—'}</td><td>{formatMoney(deal.amountCents)}</td><td><span className={`admin-status admin-status--${statusTone(deal.state)}`}>{label(deal.state)}</span></td><td>{label(deal.paymentState)}</td><td>{date(deal.createdAt)}</td></tr>)}</tbody></table></div>}
        </section>
      </main>
    </AdminFrame>
  );
}
