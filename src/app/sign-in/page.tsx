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
  const initialMode = params.mode === 'sign-up' ? 'sign-up' : 'sign-in';
  if (user !== null) redirect(returnTo);

  return (
    <main className="auth-page">
      <section className="auth-context" aria-labelledby="auth-title">
        <div>
          <div className="auth-brand">
            <img className="auth-logo" src="/assets/collecttt_logo.png" alt="CollectTT" />
          </div>
          <h1 id="auth-title">Your collection, in one place.</h1>
          <p>Buy and sell locally with a clear record of every deal.</p>
        </div>
        <a className="auth-powered-by" href="https://www.chaconialabs.com" target="_blank" rel="noreferrer">
          <span>Powered by</span>
          <img src="/assets/chaconia-labs-lockup.png" alt="Chaconia Labs" />
        </a>
      </section>

      <AuthPanel
        callbackURL={returnTo}
        consoleMode={env().EMAIL_ADAPTER === 'console'}
        initialMode={initialMode}
      />
    </main>
  );
}
