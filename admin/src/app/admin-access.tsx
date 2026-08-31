import { ShieldCheck } from 'lucide-react';

const marketplaceUrl = process.env.APP_URL ?? 'http://localhost:3000';
const adminUrl = process.env.ADMIN_APP_URL ?? 'http://localhost:3001';

export function AdminDenied({ signedIn }: { signedIn: boolean }) {
  return (
    <main className="admin-denied">
      <div className="admin-modal__backdrop" aria-hidden="true" />
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-access-title">
        <div className="admin-modal__header">
          <div className="admin-denied__mark"><ShieldCheck size={26} aria-hidden="true" /></div>
        </div>
        <div className="admin-modal__copy">
          <p className="admin-kicker">CollectTT Admin</p>
          <h1 id="admin-access-title">Admin access required</h1>
          <p>{signedIn ? 'Your account is signed in, but it does not have administrator access.' : 'Sign in with an administrator account to continue.'}</p>
        </div>
        <div className="admin-denied__actions">
          <a className="admin-button" href={`${marketplaceUrl}/sign-in?callbackURL=${encodeURIComponent(adminUrl)}`}>Sign in</a>
          <a className="admin-button admin-button--secondary" href={marketplaceUrl}>Back to CollectTT</a>
        </div>
        <p className="admin-modal__footnote">Access is controlled by your CollectTT administrator role.</p>
      </section>
      <span className="sr-only">The admin workspace is unavailable without administrator permissions.</span>
    </main>
  );
}
