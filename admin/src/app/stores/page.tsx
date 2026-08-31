import { CheckCircle2, Clock3, ExternalLink, MapPin, ShieldCheck, Store as StoreIcon, XCircle } from 'lucide-react';
import { eq } from 'drizzle-orm';

import { db } from '../../../../src/db/client';
import { profiles } from '../../../../src/db/schema/profiles';
import { storeApplications } from '../../../../src/db/schema/store-applications';
import { currentUser } from '../../../../src/lib/session';
import { listStoreApplications } from '../../../../src/services/store-applications';
import { AdminDenied } from '../admin-access';
import { AdminFrame } from '../admin-frame';
import { confirmStoreApplicationAction, declineStoreApplicationAction } from './actions';

export const dynamic = 'force-dynamic';

function displayStatus(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function linksFor(application: Awaited<ReturnType<typeof listStoreApplications>>[number]) {
  return [
    ['Website', application.websiteUrl],
    ['Instagram', application.instagramUrl],
    ['Facebook', application.facebookUrl],
    ['TikTok', application.tiktokUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
}

export default async function StoresPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const viewer = await currentUser();
  if (viewer === null) return <AdminDenied signedIn={false} />;
  const viewerProfile = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.userId, viewer.userId)).limit(1);
  if (viewerProfile[0]?.role !== 'admin') return <AdminDenied signedIn />;

  const [applications, params] = await Promise.all([listStoreApplications(), searchParams]);
  const counts = {
    pending: applications.filter((application) => application.status === 'pending').length,
    confirmed: applications.filter((application) => application.status === 'confirmed').length,
    declined: applications.filter((application) => application.status === 'declined').length,
  };

  return (
    <AdminFrame viewer={viewer} activeNav="stores">
      <main className="admin-main">
        <div className="admin-heading">
          <div><p className="admin-kicker">Trust &amp; operations</p><h1>Stores</h1><p>Review storefront applications before locations can receive inventory.</p></div>
          <span className="admin-environment">Admin only</span>
        </div>

        {params.notice ? <p className="admin-toast" role="status">{params.notice}</p> : null}

        <section className="admin-stats stores-summary" aria-label="Store application summary">
          <article className="admin-stat admin-stat--amber"><div className="admin-stat__icon"><Clock3 size={19} aria-hidden="true" /></div><div><strong>{counts.pending}</strong><span>Pending review</span></div></article>
          <article className="admin-stat admin-stat--green"><div className="admin-stat__icon"><CheckCircle2 size={19} aria-hidden="true" /></div><div><strong>{counts.confirmed}</strong><span>Confirmed Stores</span></div></article>
          <article className="admin-stat admin-stat--purple"><div className="admin-stat__icon"><StoreIcon size={19} aria-hidden="true" /></div><div><strong>{applications.length}</strong><span>Total applications</span></div></article>
          <article className="admin-stat admin-stat--blue"><div className="admin-stat__icon"><ShieldCheck size={19} aria-hidden="true" /></div><div><strong>{counts.declined}</strong><span>Declined</span></div></article>
        </section>

        <section className="admin-panel stores-panel">
          <div className="admin-panel__heading"><div><p className="admin-kicker">Application queue</p><h2>Store applications</h2></div><span>{applications.length} total</span></div>
          {applications.length === 0 ? <div className="catalog-empty"><StoreIcon className="catalog-empty__icon" size={20} aria-hidden="true" /><strong>No Store applications yet</strong><p>New applications will appear here after a member submits one.</p></div> : <div className="stores-list">
            {applications.map((application) => {
              const links = linksFor(application);
              const isPending = application.status === 'pending';
              return <article className={`store-application-card store-application-card--${application.status}`} key={application.id}>
                <div className="store-application-card__top">
                  <div><div className="store-application-card__title"><StoreIcon size={17} aria-hidden="true" /><h3>{application.storeName}</h3></div><p className="store-application-card__meta">Applied by <strong>{application.applicantName}</strong> · {application.applicantEmail}</p></div>
                  <span className={`admin-status admin-status--${application.status}`}>{application.status === 'pending' ? <Clock3 size={12} aria-hidden="true" /> : application.status === 'confirmed' ? <CheckCircle2 size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />}{displayStatus(application.status)}</span>
                </div>
                <div className="store-application-card__facts"><span><MapPin size={14} aria-hidden="true" />{application.area}, {application.city}</span><span>{application.phoneE164}</span><span>Submitted {application.createdAt.toLocaleDateString('en-TT')}</span></div>
                <details className="store-application-card__details"><summary>View application details</summary><div className="store-application-card__detail-grid"><div><strong>Address</strong><p>{[application.addressLine1, application.addressLine2, application.city, application.country].filter(Boolean).join(', ')}</p></div><div><strong>Accepted sizes</strong><p>{application.acceptsSizeClasses.map(displayStatus).join(', ')}</p></div><div><strong>Verification links</strong>{links.length === 0 ? <p>None supplied</p> : <ul>{links.map(([label, url]) => <li key={label}><a href={url} target="_blank" rel="noreferrer">{label} <ExternalLink size={12} aria-hidden="true" /></a></li>)}</ul>}</div><div><strong>Terms acceptance</strong><p>Version {application.termsVersion}, accepted {application.termsAcceptedAt.toLocaleDateString('en-TT')}</p></div></div></details>
                {isPending ? <div className="store-application-card__actions"><form action={confirmStoreApplicationAction}><input type="hidden" name="applicationId" value={application.id} /><button className="admin-button" type="submit">Confirm Store</button></form><form className="store-decline-form" action={declineStoreApplicationAction}><input type="hidden" name="applicationId" value={application.id} /><input name="adminNote" aria-label={`Optional note for ${application.storeName}`} placeholder="Optional note for applicant" /><button className="admin-button admin-button--danger" type="submit">Decline</button></form></div> : application.adminNote ? <p className="store-application-card__note"><strong>Admin note:</strong> {application.adminNote}</p> : null}
              </article>;
            })}
          </div>}
        </section>
      </main>
    </AdminFrame>
  );
}
