import Link from 'next/link';
import { and, count, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { FileClock, Search, ShieldCheck, TriangleAlert } from 'lucide-react';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { adminAuditEvents } from '@/db/schema/admin-audit';
import { profiles } from '@/db/schema/profiles';
import { adminAccess } from '@/lib/admin';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';

const PAGE_SIZE = 25;
const OUTCOMES = ['succeeded', 'failed', 'rejected'] as const;
const TARGET_TYPES = ['member', 'listing', 'transaction', 'notification_delivery'] as const;
type AuditOutcome = (typeof OUTCOMES)[number];
type AuditTargetType = (typeof TARGET_TYPES)[number];

function pageNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function dateTime(value: Date): string {
  return value.toLocaleString('en-TT', { dateStyle: 'medium', timeStyle: 'short' });
}

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(outcome: string): string {
  if (outcome === 'succeeded') return 'confirmed';
  if (outcome === 'failed') return 'declined';
  return 'pending';
}

function validDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function targetHref(targetType: string, targetId: string): string | null {
  if (targetType === 'member') return `/admin/members/${encodeURIComponent(targetId)}`;
  if (targetType === 'listing') return `/admin/listings/${encodeURIComponent(targetId)}`;
  if (targetType === 'transaction') return `/admin/deals/${encodeURIComponent(targetId)}`;
  if (targetType === 'notification_delivery') return `/admin/notifications/${encodeURIComponent(targetId)}`;
  return null;
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ q?: string; actor?: string; targetType?: string; targetId?: string; action?: string; outcome?: string; from?: string; to?: string; page?: string }> }) {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 80);
  const actor = (params.actor ?? '').trim().slice(0, 120);
  const targetId = (params.targetId ?? '').trim().slice(0, 120);
  const action = (params.action ?? '').trim().slice(0, 80);
  const selectedTargetType = TARGET_TYPES.includes(params.targetType as AuditTargetType) ? params.targetType as AuditTargetType : 'all';
  const selectedOutcome = OUTCOMES.includes(params.outcome as AuditOutcome) ? params.outcome as AuditOutcome : 'all';
  const from = validDate(params.from);
  const to = validDate(params.to, true);
  const search = `%${query}%`;
  const filter = and(
    query === '' ? undefined : or(
      ilike(adminAuditEvents.targetType, search),
      ilike(adminAuditEvents.targetId, search),
      ilike(adminAuditEvents.action, search),
      ilike(adminAuditEvents.reason, search),
      ilike(profiles.displayName, search),
      ilike(profiles.handle, search),
      ilike(users.email, search),
      ...(isUuid(query) ? [eq(adminAuditEvents.id, query)] : []),
    ),
    actor === '' ? undefined : eq(adminAuditEvents.actorUserId, actor),
    selectedTargetType === 'all' ? undefined : eq(adminAuditEvents.targetType, selectedTargetType),
    targetId === '' ? undefined : ilike(adminAuditEvents.targetId, `%${targetId}%`),
    action === '' ? undefined : ilike(adminAuditEvents.action, `%${action}%`),
    selectedOutcome === 'all' ? undefined : eq(adminAuditEvents.outcome, selectedOutcome),
    from === undefined ? undefined : gte(adminAuditEvents.occurredAt, from),
    to === undefined ? undefined : lte(adminAuditEvents.occurredAt, to),
  );

  const [summaryRows, totalRows] = await Promise.all([
    db
      .select({ outcome: adminAuditEvents.outcome, value: count() })
      .from(adminAuditEvents)
      .leftJoin(profiles, eq(profiles.userId, adminAuditEvents.actorUserId))
      .leftJoin(users, eq(users.id, profiles.userId))
      .where(filter)
      .groupBy(adminAuditEvents.outcome),
    db
      .select({ value: count() })
      .from(adminAuditEvents)
      .leftJoin(profiles, eq(profiles.userId, adminAuditEvents.actorUserId))
      .leftJoin(users, eq(users.id, profiles.userId))
      .where(filter),
  ]);
  const summary = new Map(summaryRows.map((row) => [row.outcome, Number(row.value)]));
  const total = Number(totalRows[0]?.value ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageNumber(params.page), pageCount);
  const auditRows = await db
    .select({
      id: adminAuditEvents.id,
      actorUserId: adminAuditEvents.actorUserId,
      actorName: profiles.displayName,
      actorHandle: profiles.handle,
      actorEmail: users.email,
      targetType: adminAuditEvents.targetType,
      targetId: adminAuditEvents.targetId,
      action: adminAuditEvents.action,
      reason: adminAuditEvents.reason,
      outcome: adminAuditEvents.outcome,
      beforeContext: adminAuditEvents.beforeContext,
      afterContext: adminAuditEvents.afterContext,
      occurredAt: adminAuditEvents.occurredAt,
    })
    .from(adminAuditEvents)
    .leftJoin(profiles, eq(profiles.userId, adminAuditEvents.actorUserId))
    .leftJoin(users, eq(users.id, profiles.userId))
    .where(filter)
    .orderBy(desc(adminAuditEvents.occurredAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query !== '') next.set('q', query);
    if (actor !== '') next.set('actor', actor);
    if (selectedTargetType !== 'all') next.set('targetType', selectedTargetType);
    if (targetId !== '') next.set('targetId', targetId);
    if (action !== '') next.set('action', action);
    if (selectedOutcome !== 'all') next.set('outcome', selectedOutcome);
    if (params.from !== undefined && from !== undefined) next.set('from', params.from);
    if (params.to !== undefined && to !== undefined) next.set('to', params.to);
    if (nextPage > 1) next.set('page', String(nextPage));
    const encoded = next.toString();
    return encoded === '' ? '/admin/audit' : `/admin/audit?${encoded}`;
  };

  return (
    <AdminFrame activeNav="audit">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div>
            <p className="admin-kicker">Admin workspace</p>
            <h1>Audit log</h1>
            <p>Review administrative decisions with actor, reason, target, outcome, and context.</p>
          </div>
          <span className="admin-environment">Read-only</span>
        </div>

        <section className="admin-stats admin-audit-stats" aria-label="Audit summary">
          <article className="admin-stat admin-stat--purple"><div className="admin-stat__icon"><FileClock size={19} aria-hidden="true" /></div><div><strong>{total.toLocaleString()}</strong><span>Matching events</span></div></article>
          <article className="admin-stat admin-stat--green"><div className="admin-stat__icon"><ShieldCheck size={19} aria-hidden="true" /></div><div><strong>{summary.get('succeeded') ?? 0}</strong><span>Succeeded</span></div></article>
          <article className="admin-stat admin-stat--amber"><div className="admin-stat__icon"><TriangleAlert size={19} aria-hidden="true" /></div><div><strong>{summary.get('rejected') ?? 0}</strong><span>Rejected</span></div></article>
          <article className="admin-stat admin-stat--blue"><div className="admin-stat__icon"><TriangleAlert size={19} aria-hidden="true" /></div><div><strong>{summary.get('failed') ?? 0}</strong><span>Failed</span></div></article>
        </section>

        <section className="admin-panel admin-directory-panel" aria-labelledby="audit-directory-title">
          <div className="admin-panel__heading">
            <div>
              <h2 id="audit-directory-title">Administrative events</h2>
              <p className="admin-panel__subcopy">Audit rows are append-only. Future support writes will record their reason and state context here.</p>
            </div>
            <FileClock size={19} aria-hidden="true" />
          </div>

          <form className="admin-audit-filters" method="get" role="search">
            <div className="admin-audit-filter admin-audit-filter--wide"><label htmlFor="audit-search">Search</label><div><Search size={15} aria-hidden="true" /><input id="audit-search" name="q" type="search" defaultValue={query} placeholder="Actor, target, action, reason, or event ID" autoComplete="off" /></div></div>
            <div className="admin-audit-filter"><label htmlFor="audit-actor">Actor user ID</label><input id="audit-actor" name="actor" defaultValue={actor} placeholder="Admin user ID" /></div>
            <div className="admin-audit-filter"><label htmlFor="audit-target-type">Target type</label><select id="audit-target-type" name="targetType" defaultValue={selectedTargetType}><option value="all">All target types</option>{TARGET_TYPES.map((type) => <option key={type} value={type}>{label(type)}</option>)}</select></div>
            <div className="admin-audit-filter"><label htmlFor="audit-target-id">Target ID</label><input id="audit-target-id" name="targetId" defaultValue={targetId} placeholder="Target ID" /></div>
            <div className="admin-audit-filter"><label htmlFor="audit-action">Action</label><input id="audit-action" name="action" defaultValue={action} placeholder="e.g. suspend" /></div>
            <div className="admin-audit-filter"><label htmlFor="audit-outcome">Outcome</label><select id="audit-outcome" name="outcome" defaultValue={selectedOutcome}><option value="all">All outcomes</option>{OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{label(outcome)}</option>)}</select></div>
            <div className="admin-audit-filter"><label htmlFor="audit-from">From</label><input id="audit-from" name="from" type="date" defaultValue={params.from ?? ''} /></div>
            <div className="admin-audit-filter"><label htmlFor="audit-to">To</label><input id="audit-to" name="to" type="date" defaultValue={params.to ?? ''} /></div>
            <button className="admin-button admin-audit-filter__submit" type="submit">Apply filters</button>
          </form>

          {auditRows.length === 0 ? (
            <div className="admin-directory-empty" role="status">
              <FileClock size={22} aria-hidden="true" />
              <strong>{total === 0 && query === '' && actor === '' && targetId === '' && action === '' ? 'No admin events yet' : 'No audit events found'}</strong>
              <p>{total === 0 && query === '' && actor === '' && targetId === '' && action === '' ? 'Audited support actions will appear here once administrative writes are enabled.' : 'Try a broader target, actor, action, outcome, or date range.'}</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-detail-table admin-audit-table">
                <caption className="sr-only">Administrative audit events</caption>
                <thead><tr><th scope="col">Occurred</th><th scope="col">Actor</th><th scope="col">Target</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Reason</th><th scope="col">Context</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{auditRows.map((event) => { const target = targetHref(event.targetType, event.targetId); return <tr key={event.id}><th scope="row">{dateTime(event.occurredAt)}<small>{event.id}</small></th><td>{event.actorName === null ? 'Deleted / unavailable actor' : <Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(event.actorUserId ?? '')}`}>{event.actorName}</Link>}<small>{event.actorEmail ?? event.actorUserId ?? '—'}</small></td><td>{target === null ? <><strong>{label(event.targetType)}</strong><small>{event.targetId}</small></> : <Link className="admin-row-link" href={target}>{label(event.targetType)}<small>{event.targetId}</small></Link>}</td><td>{label(event.action)}</td><td><span className={`admin-status admin-status--${statusTone(event.outcome)}`}>{label(event.outcome)}</span></td><td>{event.reason}</td><td><div className="admin-audit-context"><span>Before: {JSON.stringify(event.beforeContext)}</span><span>After: {JSON.stringify(event.afterContext)}</span></div></td><td><Link className="admin-row-link" href={`/admin/audit/${encodeURIComponent(event.id)}`}>View event</Link></td></tr>; })}</tbody>
              </table>
            </div>
          )}

          <nav className="admin-pagination" aria-label="Audit event pages">
            <span>Page {page} of {pageCount}</span>
            <div>
              {page <= 1 ? <span className="admin-button admin-button--secondary is-disabled" aria-disabled="true">Previous</span> : <Link className="admin-button admin-button--secondary" href={buildHref(page - 1)}>Previous</Link>}
              {page >= pageCount ? <span className="admin-button admin-button--secondary is-disabled" aria-disabled="true">Next</span> : <Link className="admin-button admin-button--secondary" href={buildHref(page + 1)}>Next</Link>}
            </div>
          </nav>
        </section>
      </main>
    </AdminFrame>
  );
}
