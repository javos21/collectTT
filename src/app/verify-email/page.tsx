import { VerificationResult } from './verification-result';
import { AuthShell } from '@/components/auth-shell';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;
  const error = typeof params.error === 'string' ? params.error : null;

  return (
    <AuthShell>
      <section className="auth-panel" aria-labelledby="verification-title">
        <div className="auth-panel__head">
          <span className="verification-mark" aria-hidden="true">C</span>
          <h1 id="verification-title">Confirming your email</h1>
          <p>We’re checking your verification link now.</p>
        </div>
        <VerificationResult token={token} initialError={error} />
      </section>
    </AuthShell>
  );
}
