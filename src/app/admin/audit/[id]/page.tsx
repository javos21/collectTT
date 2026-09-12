import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { ArrowLeft, FileClock, ShieldCheck, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { adminAuditEvents } from '@/db/schema/admin-audit';
import { profiles } from '@/db/schema/profiles';
import { requireAdmin } from '@/lib/admin';
import { AdminFrame } from '../../admin-frame';

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

function targetHref(targetType: string, targetId: string): string | null {
  if (targetType === 'member') return `/admin/members/${encodeURIComponent(targetId)}`;
  if (targetType === 'listing') return `/admin/listings/${encodeURIComponent(targetId)}`;
  if (targetType === 'transaction') return `/admin/deals/${encodeURIComponent(targetId)}`;
  if (targetType === 'notification_delivery') return `/admin/notifications/${encodeURIComponent(targetId)}`;
  return null;
}

export default async function AdminAuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/audit/${encodeURIComponent(id)}`);

  const rows = await db
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
      requestMetadata: adminAuditEvents.requestMetadata,
      occurredAt: adminAuditEvents.occurredAt,
    })
    .from(adminAuditEvents)
    .leftJoin(profiles, eq(profiles.userId, adminAuditEvents.actorUserId))
    .leftJoin(users, eq(users.id, profiles.userId))
    .where(eq(adminAuditEvents.id, id))
    .limit(1);
  const event = rows[0];
  if (event === undefined) notFound();
  const target = targetHref(event.targetType, event.targetId);

  return (
    <AdminFrame activeNav="audit">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading admin-heading--detail">
          <div>
            <Link className="admin-back-link" href="/admin/audit"><ArrowLeft size={15} aria-hidden="true" />Audit log</Link>
            <p className="admin-kicker">Audit event</p>
            <h1>{label(event.action)}</h1>
            <p>{label(event.targetType)} · Occurred {dateTime(event.occurredAt)}</p>
          </div>
          <span className={`admin-status admin-status--${statusTone(event.outcome)}`}>{label(event.outcome)}</span>
        </div>

        <div className="admin-detail-grid">
          <section className="admin-panel" aria-labelledby="audit-actor-title">
            <div className="admin-panel__heading"><div><h2 id="audit-actor-title">Actor</h2><p className="admin-panel__subcopy">Administrator associated with the attempt.</p></div><UserRound size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Member</dt><dd>{event.actorUserId === null ? 'Deleted / unavailable actor' : <Link href={`/admin/members/${encodeURIComponent(event.actorUserId)}`}><UserRound size={14} aria-hidden="true" />{event.actorName ?? event.actorUserId}</Link>}<small>{event.actorEmail ?? event.actorHandle ?? event.actorUserId ?? '—'}</small></dd></div>
              <div><dt>Actor ID</dt><dd><code>{event.actorUserId ?? '—'}</code></dd></div>
              <div><dt>Occurred</dt><dd>{dateTime(event.occurredAt)}</dd></div>
            </dl>
          </section>

          <section className="admin-panel" aria-labelledby="audit-target-title">
            <div className="admin-panel__heading"><div><h2 id="audit-target-title">Target</h2><p className="admin-panel__subcopy">Object affected by the administrative attempt.</p></div><ShieldCheck size={19} aria-hidden="true" /></div>
            <dl className="admin-detail-list">
              <div><dt>Target type</dt><dd>{label(event.targetType)}</dd></div>
              <div><dt>Target ID</dt><dd>{target === null ? <code>{event.targetId}</code> : <Link href={target}><code>{event.targetId}</code></Link>}</dd></div>
              <div><dt>Action</dt><dd>{label(event.action)}</dd></div>
              <div><dt>Outcome</dt><dd><span className={`admin-status admin-status--${statusTone(event.outcome)}`}>{label(event.outcome)}</span></dd></div>
            </dl>
          </section>
        </div>

        <section className="admin-panel admin-detail-section" aria-labelledby="audit-reason-title">
          <div className="admin-panel__heading"><div><h2 id="audit-reason-title">Reason</h2><p className="admin-panel__subcopy">Required explanation for the administrative decision.</p></div><FileClock size={19} aria-hidden="true" /></div>
          <p className="admin-detail-note">{event.reason}</p>
        </section>

        <div className="admin-detail-grid admin-audit-context-grid">
          <section className="admin-panel" aria-labelledby="audit-before-title"><div className="admin-panel__heading"><div><h2 id="audit-before-title">Before context</h2><p className="admin-panel__subcopy">State captured before the action.</p></div></div><pre className="admin-json-block"><code>{JSON.stringify(event.beforeContext, null, 2)}</code></pre></section>
          <section className="admin-panel" aria-labelledby="audit-after-title"><div className="admin-panel__heading"><div><h2 id="audit-after-title">After context</h2><p className="admin-panel__subcopy">State captured after the action.</p></div></div><pre className="admin-json-block"><code>{JSON.stringify(event.afterContext, null, 2)}</code></pre></section>
        </div>

        <section className="admin-panel admin-detail-section" aria-labelledby="audit-request-title">
          <div className="admin-panel__heading"><div><h2 id="audit-request-title">Request metadata</h2><p className="admin-panel__subcopy">Operational metadata such as request ID, source, or safe device context. Secrets should never be stored here.</p></div></div>
          <pre className="admin-json-block"><code>{JSON.stringify(event.requestMetadata, null, 2)}</code></pre>
        </section>
      </main>
    </AdminFrame>
  );
}
