import { redirect } from 'next/navigation';

import { safeAuthReturnTo } from '@/lib/auth-redirect';
import { currentUser } from '@/lib/session';
import { env } from '@/lib/env';
import { AuthPanel } from './auth-panel';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  const params = await searchParams;
  const returnTo = safeAuthReturnTo(params.returnTo);
  if (user !== null) redirect(returnTo);

  return (
    <main className="auth-page">
      <section className="auth-context" aria-labelledby="auth-title">
        <div>
          <span className="auth-mark" aria-hidden="true">C</span>
          <h1 id="auth-title">Your collection has a trusted place.</h1>
          <p>
            Buy, sell and coordinate handoffs with a record that follows every deal from
            first claim to final collection.
          </p>
        </div>
        <ul className="auth-proof" aria-label="CollectTT trust features">
          <li>Payments stay between buyer and seller</li>
          <li>Claims, bids and deadlines use server time</li>
          <li>Relay releases require confirmed payment</li>
        </ul>
      </section>

      <AuthPanel
        callbackURL={returnTo}
        consoleMode={env().EMAIL_ADAPTER === 'console'}
        oauthFailed={typeof params.error === 'string' || params.oauth === 'failed'}
      />
    </main>
  );
}
