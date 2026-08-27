import Link from 'next/link';

import { safeAuthReturnTo } from '@/lib/auth-redirect';
import { ForgotPasswordForm } from './reset-request-form';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeAuthReturnTo(params.returnTo);
  const signInHref = returnTo === '/'
    ? '/sign-in'
    : `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="auth-single">
      <section className="auth-panel" aria-labelledby="forgot-title">
        <div className="auth-panel__head">
          <h1 id="forgot-title">Reset your password</h1>
          <p>Enter your account email. If it matches an account, we’ll send a secure reset link.</p>
        </div>
        <ForgotPasswordForm returnTo={returnTo} />
        <Link className="auth-back" href={signInHref}>Back to sign in</Link>
      </section>
    </main>
  );
}
