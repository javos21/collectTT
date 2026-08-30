'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { UserRound } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { AuthFeedback } from '@/components/auth-feedback';
import { PasswordField } from '@/components/password-field';
import { Button } from '@/components/ui/button';

type Mode = 'sign-in' | 'sign-up';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AuthPanelProps {
  callbackURL: string;
  consoleMode: boolean;
  oauthFailed: boolean;
  initialMode?: Mode;
}

function errorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string; status?: number } | null;
  if (e?.status === 429) return 'Too many attempts. Wait a moment, then try again.';
  switch (e?.code) {
    case 'EMAIL_NOT_VERIFIED':
      return 'Verify your email before signing in. You can resend the verification email below.';
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_PASSWORD':
      return 'That email and password do not match.';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account already uses that email. Sign in instead.';
    case 'PASSWORD_TOO_SHORT':
      return 'Use at least 12 characters for your password.';
    default:
      return e?.message === 'Failed to fetch'
        ? 'We could not reach CollectTT. Check your connection and try again.'
        : 'We could not complete that request. Please try again.';
  }
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.38l-3.24-2.53c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.77-5.61-4.14H3.04v2.61A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.91A6.02 6.02 0 0 1 6.08 12c0-.66.11-1.3.31-1.91V7.48H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.52l3.35-2.61Z" />
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.35 2.61C7.18 7.72 9.39 5.95 12 5.95Z" />
    </svg>
  );
}

export function AuthPanel({ callbackURL, consoleMode, oauthFailed, initialMode = 'sign-in' }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(oauthFailed ? 'Google sign-in did not finish. Please try again.' : '');
  const [notice, setNotice] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');

  async function googleSignIn() {
    setPending(true);
    setError('');
    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL,
        errorCallbackURL: '/sign-in?oauth=failed',
      });
      if (result.error !== null) {
        setError(errorMessage(result.error));
        setPending(false);
      }
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');

    try {
      if (email === '') {
        setError('Enter your email address.');
        return;
      }
      if (!EMAIL_PATTERN.test(email)) {
        setError('Enter a valid email address, like you@example.com.');
        return;
      }
      if (password.length < 12) {
        setError(`Password needs at least 12 characters. You have entered ${password.length}.`);
        return;
      }

      if (mode === 'sign-up') {
        const name = String(form.get('name') ?? '').trim();
        const confirmPassword = String(form.get('confirmPassword') ?? '');
        if (name.length < 2) {
          setError('Enter the name other members should know you by.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Password confirmation does not match. Check both fields and try again.');
          return;
        }

        const result = await authClient.signUp.email({ name, email, password, callbackURL });
        if (result.error !== null) {
          setError(errorMessage(result.error));
        } else {
          setNotice('Check your email to verify your account. The link expires in one hour.');
          setVerificationEmail(email);
        }
        return;
      }

      const result = await authClient.signIn.email({ email, password, callbackURL });
      if (result.error !== null) {
        setError(errorMessage(result.error));
        if (result.error.code === 'EMAIL_NOT_VERIFIED') setVerificationEmail(email);
        return;
      }
      window.location.assign(callbackURL);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function resendVerification() {
    if (verificationEmail === '') return;
    setPending(true);
    setError('');
    try {
      const result = await authClient.sendVerificationEmail({
        email: verificationEmail,
        callbackURL,
      });
      if (result.error !== null) setError(errorMessage(result.error));
      else setNotice('Verification email sent. The link expires in one hour.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setNotice('');
    setVerificationEmail('');
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-form-title">
      <div className="auth-panel__head">
        <span className="auth-panel__icon" aria-hidden="true"><UserRound /></span>
        <h2 id="auth-form-title">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>
      </div>

      <Button className="google-button" color="secondary" type="button" onPress={googleSignIn} isDisabled={pending}>
        <GoogleIcon />
        Continue with Google
      </Button>

      <div className="auth-divider"><span>or use email</span></div>

      {error !== '' && <AuthFeedback tone="error">{error}</AuthFeedback>}
      {notice !== '' && <AuthFeedback tone="info">{notice}</AuthFeedback>}

      {verificationEmail !== '' ? (
        <div className="auth-verification">
          <Button color="secondary" type="button" onPress={resendVerification} isDisabled={pending}>
            Resend verification email
          </Button>
          <Button className="auth-text-button" color="link" type="button" onPress={() => switchMode('sign-in')}>
            Return to sign in
          </Button>
        </div>
      ) : (
        <form className="auth-form" noValidate onSubmit={submit}>
          {mode === 'sign-up' && (
            <div>
              <label htmlFor="auth-name">Display name</label>
              <input id="auth-name" name="name" type="text" autoComplete="name" minLength={2} maxLength={80} required />
            </div>
          )}
          <div>
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" name="email" type="email" autoComplete="email" maxLength={254} required />
          </div>
          <div>
            <label htmlFor="auth-password">Password</label>
            <PasswordField
              label="Password"
              id="auth-password"
              name="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              minLength={12}
              maxLength={128}
              aria-describedby={mode === 'sign-up' ? 'password-help' : undefined}
              required
            />
            {mode === 'sign-up' && <small id="password-help" className="field-help">At least 12 characters.</small>}
          </div>
          {mode === 'sign-up' && (
            <div>
              <label htmlFor="auth-confirm-password">Confirm password</label>
              <PasswordField
                label="password confirmation"
                id="auth-confirm-password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </div>
          )}

          {mode === 'sign-in' && (
            <Link
              className="auth-forgot"
              href={{ pathname: '/forgot-password', query: { returnTo: callbackURL } }}
            >
              Forgot password?
            </Link>
          )}
          <Button className="auth-submit" type="submit" isDisabled={pending}>
            {pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in with email' : 'Create account with email'}
          </Button>
        </form>
      )}

      <p className="auth-switch">
        {mode === 'sign-in' ? 'New to CollectTT?' : 'Already have an account?'}{' '}
        <Button className="auth-text-button" color="link" type="button" onPress={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
          {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
        </Button>
      </p>

      {consoleMode && (
        <p className="auth-dev-note">
          Local email mode is active. Verification and reset links print in the dev-server terminal.
        </p>
      )}
    </section>
  );
}
