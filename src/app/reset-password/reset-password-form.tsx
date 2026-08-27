'use client';

import { useState, type FormEvent } from 'react';

import { authClient } from '@/lib/auth-client';
import { AuthFeedback } from '@/components/auth-feedback';
import { PasswordField } from '@/components/password-field';

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirmPassword') ?? '');
    if (password.length < 12) {
      setError(`Password needs at least 12 characters. You have entered ${password.length}.`);
      return;
    }
    if (password !== confirm) {
      setError('Password confirmation does not match. Check both fields and try again.');
      return;
    }

    setPending(true);
    setError('');
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error !== null) setError('That reset link is invalid or expired. Request a new one.');
      else setComplete(true);
    } catch {
      setError('We could not reach CollectTT. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  if (complete) return <AuthFeedback tone="info">Password updated. You can now sign in.</AuthFeedback>;

  return (
    <form className="auth-form" noValidate onSubmit={submit}>
      {error !== '' && <AuthFeedback tone="error">{error}</AuthFeedback>}
      <div>
        <label htmlFor="new-password">New password</label>
        <PasswordField
          label="new password"
          id="new-password"
          name="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      <div>
        <label htmlFor="confirm-new-password">Confirm new password</label>
        <PasswordField
          label="password confirmation"
          id="confirm-new-password"
          name="confirmPassword"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      <button className="auth-submit" type="submit" disabled={pending}>{pending ? 'Updating…' : 'Update password'}</button>
    </form>
  );
}
