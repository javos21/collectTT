import Link from 'next/link';
import { count, desc, eq, ilike, or } from 'drizzle-orm';
import { Search, ShieldCheck, UserRound } from 'lucide-react';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { profiles } from '@/db/schema/profiles';
import { adminAccess } from '@/lib/admin';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';

const PAGE_SIZE = 20;

function pageNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function date(value: Date): string {
  return value.toLocaleDateString('en-TT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusTone(status: string): string {
  if (status === 'active') return 'active';
  if (status === 'suspended' || status === 'banned') return 'declined';
  return 'draft';
}

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { viewer, isAdmin } = await adminAccess();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  if (!isAdmin) return <AdminDenied signedIn />;

  const params = await searchParams;
  const query = (params.q ?? '').trim().slice(0, 80);
  const requestedPage = pageNumber(params.page);
  const search = `%${query}%`;
  const filter = query === ''
    ? undefined
    : or(
        eq(profiles.userId, query),
        ilike(users.email, search),
        ilike(users.name, search),
        ilike(profiles.displayName, search),
        ilike(profiles.handle, search),
      );

  const totalRows = await db.select({ value: count() }).from(profiles).innerJoin(users, eq(users.id, profiles.userId)).where(filter);
  const total = Number(totalRows[0]?.value ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const memberRows = await db
    .select({
      userId: profiles.userId,
      displayName: profiles.displayName,
      handle: profiles.handle,
      email: users.email,
      role: profiles.role,
      status: profiles.status,
      emailVerified: users.emailVerified,
      memberSince: profiles.memberSince,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(filter)
    .orderBy(desc(profiles.memberSince))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  const buildHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (query !== '') next.set('q', query);
    if (nextPage > 1) next.set('page', String(nextPage));
    const encoded = next.toString();
    return encoded === '' ? '/admin/members' : `/admin/members?${encoded}`;
  };

  return (
    <AdminFrame activeNav="members">
      <main className="admin-main" id="admin-main">
        <div className="admin-heading">
          <div>
            <p className="admin-kicker">Admin workspace</p>
            <h1>Members</h1>
            <p>Find accounts and review trust context before any support action.</p>
          </div>
          <span className="admin-environment">Read-only</span>
        </div>

        <section className="admin-panel admin-directory-panel" aria-labelledby="members-directory-title">
          <div className="admin-panel__heading">
            <div>
              <h2 id="members-directory-title">Member directory</h2>
              <p className="admin-panel__subcopy">{total.toLocaleString()} member{total === 1 ? '' : 's'}{query === '' ? '' : ` matching “${query}”`}</p>
            </div>
            <UserRound size={19} aria-hidden="true" />
          </div>

          <form className="admin-directory-search" method="get" role="search">
            <label htmlFor="member-search">Search members</label>
            <div>
              <Search size={16} aria-hidden="true" />
              <input id="member-search" name="q" type="search" defaultValue={query} placeholder="Email, handle, name, or user ID" autoComplete="off" />
              <button className="admin-button" type="submit">Search</button>
            </div>
          </form>

          {memberRows.length === 0 ? (
            <div className="admin-directory-empty" role="status">
              <ShieldCheck size={22} aria-hidden="true" />
              <strong>{query === '' ? 'No members yet' : 'No members found'}</strong>
              <p>{query === '' ? 'Members will appear here after accounts are created.' : 'Try an email, handle, display name, or exact user ID.'}</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-directory-table">
                <caption className="sr-only">Member directory</caption>
                <thead>
                  <tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Email</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {memberRows.map((member) => (
                    <tr key={member.userId}>
                      <th scope="row">
                        <Link className="admin-directory-member" href={`/admin/members/${encodeURIComponent(member.userId)}`}>
                          <span className="admin-directory-avatar" aria-hidden="true"><UserRound size={16} /></span>
                          <span><strong>{member.displayName}</strong><small>@{member.handle}</small></span>
                        </Link>
                      </th>
                      <td><span className="admin-status admin-status--draft">{member.role.replaceAll('_', ' ')}</span></td>
                      <td><span className={`admin-status admin-status--${statusTone(member.status)}`}>{member.status}</span></td>
                      <td><span className="admin-directory-email">{member.email}</span><small>{member.emailVerified ? 'Verified email' : 'Unverified email'}</small></td>
                      <td>{date(member.memberSince)}</td>
                      <td><Link className="admin-row-link" href={`/admin/members/${encodeURIComponent(member.userId)}`}>View member</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <nav className="admin-pagination" aria-label="Member directory pages">
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
