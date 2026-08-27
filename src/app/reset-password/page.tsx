import Link from 'next/link';

import { safeAuthReturnTo } from '@/lib/auth-redirect';
import { ResetPasswordForm } from './reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : undefined;
  const error = params.error;
  const returnTo = safeAuthReturnTo(params.returnTo);
  const invalid = token === undefined || token === '' || error !== undefined;
  const signInHref = returnTo === '/'
    ? '/sign-in'
    : `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  const forgotHref = returnTo === '/'
    ? '/forgot-password'
    : `/forgot-password?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main className="auth-single">
      <section className="auth-panel" aria-labelledby="reset-title">
        <div className="auth-panel__head">
          <h1 id="reset-title">Choose a new password</h1>
          <p>Use a unique password with at least 12 characters.</p>
        </div>
        {invalid ? (
          <div className="alert alert--error" role="alert">That reset link is missing, invalid or expired. Request a new one.</div>
        ) : (
          <ResetPasswordForm token={token} />
        )}
        <Link className="auth-back" href={invalid ? forgotHref : signInHref}>{invalid ? 'Request another link' : 'Back to sign in'}</Link>
      </section>
    </main>
  );
}
