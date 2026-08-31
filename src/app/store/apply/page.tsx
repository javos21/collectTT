import Link from 'next/link';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { redirect } from 'next/navigation';

import { currentUser } from '@/lib/session';
import { latestStoreApplicationFor } from '@/services/store-applications';
import { StoreApplicationForm } from './store-application-form';

export const dynamic = 'force-dynamic';

function statusLabel(status: 'pending' | 'confirmed' | 'declined'): string {
  return status === 'pending' ? 'Under review' : status === 'confirmed' ? 'Confirmed' : 'Needs a new application';
}

export default async function StoreApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const viewer = await currentUser();
  if (viewer === null) redirect('/sign-in?returnTo=/store/apply');
  const [application, params] = await Promise.all([
    latestStoreApplicationFor(viewer.userId),
    searchParams,
  ]);

  return (
    <main className="store-application-page">
      <div className="store-application-header">
        <div>
          <p className="section-label">Store partner application</p>
          <h1>Apply to become a Store</h1>
          <p className="lede">Give collectors a reliable local place to drop off and pick up items. We review every Store before it can receive inventory.</p>
        </div>
        <Link className="button secondary" href="/store">Store workspace</Link>
      </div>

      {params.submitted ? <p className="alert alert--info" role="status"><CheckCircle2 size={18} aria-hidden="true" /> Your application is submitted. We&apos;ll review the details before confirming the Store.</p> : null}

      {application?.status === 'pending' ? (
        <section className="store-application-status card" aria-labelledby="application-status-title">
          <div className="store-application-status__icon"><ClipboardCheck size={24} aria-hidden="true" /></div>
          <div>
            <p className="section-label">Application status</p>
            <h2 id="application-status-title">{statusLabel(application.status)}</h2>
            <p>We received <strong>{application.storeName}</strong> on {application.createdAt.toLocaleDateString('en-TT')}. An admin will verify the storefront details before access is granted.</p>
            <p className="muted">Signed in as {viewer.email}. You can return here to check for an update.</p>
          </div>
        </section>
      ) : application?.status === 'confirmed' ? (
        <section className="store-application-status card" aria-labelledby="application-status-title">
          <div className="store-application-status__icon store-application-status__icon--confirmed"><CheckCircle2 size={24} aria-hidden="true" /></div>
          <div>
            <p className="section-label">Application status</p>
            <h2 id="application-status-title">Store confirmed</h2>
            <p><strong>{application.storeName}</strong> is ready. You are its manager and can now manage drop-offs, pickups, and custody inventory.</p>
            <Link className="button" href="/store">Open Store workspace</Link>
          </div>
        </section>
      ) : (
        <StoreApplicationForm displayName={viewer.displayName} email={viewer.email} initialError={params.error} declined={application?.status === 'declined'} />
      )}
    </main>
  );
}
