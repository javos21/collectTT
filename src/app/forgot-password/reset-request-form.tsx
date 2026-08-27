'use client';

import { useState, type FormEvent } from 'react';

import { authClient } from '@/lib/auth-client';
import { AuthFeedback } from '@/components/auth-feedback';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm({ returnTo }: { returnTo: string }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') ?? '').trim().toLowerCase();
    if (email === '') {
      setError('Enter your email address.');
      setPending(false);
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address, like you@example.com.');
      setPending(false);
      return;
    }
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `/reset-password?returnTo=${encodeURIComponent(returnTo)}`,
      });
      if (result.error !== null) {
        setError(result.error.status === 429 ? 'Too many attempts. Wait a moment, then try again.' : 'We could not send the reset email. Check your connection and try again.');
      } else {
        setSent(true);
      }
    } catch {
      setError('We could not reach CollectTT. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return <AuthFeedback tone="info">If that email belongs to an account, a reset link is on its way.</AuthFeedback>;
  }

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      {error !== '' && <AuthFeedback tone="error">{error}</AuthFeedback>}
      <div>
        <label htmlFor="reset-email">Email</label>
        <input id="reset-email" name="email" type="email" autoComplete="email" maxLength={254} required />
      </div>
      <button className="auth-submit" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</button>
    </form>
  );
}
