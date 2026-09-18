import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { supportCases } from '@/db/schema/support-cases';
import { requireAdmin } from '@/lib/admin';
import { AdminFrame } from '../admin-frame';
import { updateSupportCaseAction } from '../actions';

export const dynamic = 'force-dynamic';

function label(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function targetHref(targetType: string, targetId: string): string {
  if (targetType === 'transaction') return `/admin/deals/${targetId}`;
  if (targetType === 'account') return `/admin/members/${targetId}`;
  return `/listings/${targetId}`;
}

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ status?: string; adminSuccess?: string; adminError?: string }> }) {
  await requireAdmin('/admin/support');
  const params = await searchParams;
  const selectedStatus = ['open', 'in_review', 'resolved', 'dismissed'].includes(params.status ?? '') ? params.status! : 'open';
  const rows = await db
    .select({
      support: supportCases,
      reporterName: profiles.displayName,
      reporterHandle: profiles.handle,
    })
    .from(supportCases)
    .innerJoin(profiles, eq(profiles.userId, supportCases.reporterUserId))
    .where(eq(supportCases.status, selectedStatus))
    .orderBy(desc(supportCases.createdAt))
    .limit(100);

  return (
    <AdminFrame activeNav="support">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div><p className="admin-kicker">Private queue</p><h1>Support cases</h1><p>Reports across listings, auctions, deals, and accounts. Reporter identity is visible only to administrators.</p></div>
        </div>
        {params.adminSuccess !== undefined && <p className="admin-form-success" role="status">{params.adminSuccess}</p>}
        {params.adminError !== undefined && <p className="admin-form-error" role="alert">{params.adminError}</p>}
        <div className="admin-filter-tabs" role="tablist" aria-label="Support case status">
          {['open', 'in_review', 'resolved', 'dismissed'].map((status) => <Link key={status} className={selectedStatus === status ? 'is-active' : ''} href={`/admin/support?status=${status}`}>{label(status)}</Link>)}
        </div>
        <section className="admin-panel admin-detail-section">
          {rows.length === 0 ? <p className="admin-empty-copy">No {label(selectedStatus).toLowerCase()} support cases.</p> : (
            <div className="admin-table-wrap"><table className="admin-detail-table"><caption className="sr-only">Support cases</caption><thead><tr><th scope="col">Report</th><th scope="col">Reporter</th><th scope="col">Target</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>
              {rows.map(({ support, reporterName, reporterHandle }) => (
                <tr key={support.id}>
                  <th scope="row"><strong>{label(support.category)}</strong><p className="admin-table__detail">{support.detail}</p><small>{support.createdAt.toLocaleString('en-TT')}</small></th>
                  <td>{reporterName}<small>@{reporterHandle}</small></td>
                  <td><Link className="admin-row-link" href={targetHref(support.targetType, support.targetId)}>{label(support.targetType)}</Link><small>{support.targetId}</small></td>
                  <td><span className="admin-status admin-status--pending">{label(support.status)}</span></td>
                  <td>
                    <form className="admin-inline-action" action={updateSupportCaseAction}>
                      <input type="hidden" name="caseId" value={support.id} />
                      <input type="hidden" name="expectedStatus" value={support.status} />
                      <select name="status" defaultValue={support.status} aria-label="New support case status"><option value="open">Open</option><option value="in_review">In review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select>
                      <input name="resolution" type="text" placeholder="Resolution note (required to close)" minLength={10} maxLength={500} />
                      <button className="admin-button" type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </section>
      </main>
    </AdminFrame>
  );
}
