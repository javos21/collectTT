'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AuthFeedback } from '@/components/auth-feedback';

type VerificationState = 'pending' | 'success' | 'error';

function errorCopy(error: string | null): string {
  switch (error) {
    case 'TOKEN_EXPIRED':
      return 'This verification link has expired. Sign in to request a new one.';
    case 'INVALID_TOKEN':
      return 'This verification link is invalid. Sign in to request a new one.';
    case 'USER_NOT_FOUND':
      return 'We could not find the account for this verification link.';
    default:
      return 'We could not verify this link. Sign in to request a new verification email.';
  }
}

export function VerificationResult({ token, initialError }: { token: string | null; initialError: string | null }) {
  const [state, setState] = useState<VerificationState>(initialError === null && token !== null ? 'pending' : 'error');
  const [error, setError] = useState(initialError);

  useEffect(() => {
    if (token === null || initialError !== null) return;
    const verificationToken = token;

    let cancelled = false;
    async function verify() {
      try {
        const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const payload = (await response.json().catch(() => null)) as { status?: boolean; message?: string } | null;
        if (!response.ok || payload?.status !== true) {
          throw new Error(payload?.message ?? 'verification_failed');
        }
        if (!cancelled) setState('success');
      } catch {
        if (!cancelled) {
          setError('verification_failed');
          setState('error');
        }
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [initialError, token]);

  if (state === 'pending') {
    return <AuthFeedback tone="info">Verifying your email…</AuthFeedback>;
  }

  if (state === 'success') {
    return (
      <div className="verification-success">
        <AuthFeedback tone="info">Your email has been successfully verified.</AuthFeedback>
        <p className="verification-success__copy">Your CollectTT account is ready to use.</p>
        <Link className="button verification-success__link" href="/listings">Go to listings</Link>
      </div>
    );
  }

  return (
    <div className="verification-error">
      <AuthFeedback tone="error">{errorCopy(error)}</AuthFeedback>
      <Link className="button secondary verification-success__link" href="/sign-in">Back to sign in</Link>
    </div>
  );
}
