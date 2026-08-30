'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, LoaderCircle, UserRound, XCircle } from 'lucide-react';

import { authClient } from '@/lib/auth-client';
import { AuthFeedback } from '@/components/auth-feedback';
import { PasswordField } from '@/components/password-field';
import { Button } from '@/components/ui/button';

type Mode = 'sign-in' | 'sign-up';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;

type AvailabilityState = 'idle' | 'checking' | 'available' | 'taken' | 'error';
type AvailabilityField = 'username' | 'email';

interface Availability {
  state: AvailabilityState;
  message: string;
  value: string;
}

const EMPTY_AVAILABILITY: Availability = { state: 'idle', message: '', value: '' };

interface AuthPanelProps {
  callbackURL: string;
  consoleMode: boolean;
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
    case 'OTP_EXPIRED':
      return 'That verification code expired. Request a new code and try again.';
    case 'INVALID_OTP':
      return 'That verification code is not correct. Check the email and try again.';
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many incorrect codes. Request a new code before trying again.';
    default:
      return e?.message === 'Failed to fetch'
        ? 'We could not reach CollectTT. Check your connection and try again.'
        : 'We could not complete that request. Please try again.';
  }
}

export function AuthPanel({ callbackURL, consoleMode, initialMode = 'sign-in' }: AuthPanelProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [availability, setAvailability] = useState<Record<AvailabilityField, Availability>>({
    username: EMPTY_AVAILABILITY,
    email: EMPTY_AVAILABILITY,
  });
  const availabilityRequest = useRef<Record<AvailabilityField, number>>({ username: 0, email: 0 });

  function normalizedValue(field: AvailabilityField, rawValue: string) {
    const value = rawValue.trim();
    return field === 'email' ? value.toLowerCase() : value;
  }

  async function checkAvailability(field: AvailabilityField, rawValue: string): Promise<boolean> {
    const value = normalizedValue(field, rawValue);
    const valid = field === 'email' ? EMAIL_PATTERN.test(value) : USERNAME_PATTERN.test(value);

    if (!valid) {
      const message = field === 'email'
        ? 'Enter a valid email address, like you@example.com.'
        : 'Use 3–30 letters, numbers, underscores, or periods.';
      setAvailability((current) => ({
        ...current,
        [field]: { state: 'error', message, value },
      }));
      return false;
    }

    const requestId = availabilityRequest.current[field] + 1;
    availabilityRequest.current[field] = requestId;
    setAvailability((current) => ({
      ...current,
      [field]: { state: 'checking', message: '', value },
    }));

    try {
      const response = await fetch(
        `/api/auth/availability?field=${field}&value=${encodeURIComponent(value)}`,
        { cache: 'no-store' },
      );
      const result = (await response.json()) as { available?: boolean; message?: string };
      if (availabilityRequest.current[field] !== requestId) return false;

      if (!response.ok || result.available !== true) {
        setAvailability((current) => ({
          ...current,
          [field]: {
            state: response.ok ? 'taken' : 'error',
            message: response.ok
              ? field === 'email'
                ? 'That email is already registered. Sign in instead.'
                : 'That username is already taken.'
              : result.message ?? 'We could not check that right now. Try again.',
            value,
          },
        }));
        return false;
      }

      setAvailability((current) => ({
        ...current,
        [field]: {
          state: 'available',
          message: field === 'email' ? 'Email is available.' : 'Username is available.',
          value,
        },
      }));
      return true;
    } catch {
      if (availabilityRequest.current[field] !== requestId) return false;
      setAvailability((current) => ({
        ...current,
        [field]: { state: 'error', message: 'We could not check that right now. Try again.', value },
      }));
      return false;
    }
  }

  function updateAvailabilityField(field: AvailabilityField, value: string) {
    setAvailability((current) => ({ ...current, [field]: EMPTY_AVAILABILITY }));
    if (field === 'username') setUsername(value);
    else setEmail(value);
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
        const requestedUsername = String(form.get('username') ?? '').trim();
        const confirmPassword = String(form.get('confirmPassword') ?? '');
        if (!USERNAME_PATTERN.test(requestedUsername)) {
          setError('Use 3–30 letters, numbers, underscores, or periods for your username.');
          return;
        }
        if (!(await checkAvailability('username', requestedUsername))) {
          setError('Choose another username before creating your account.');
          return;
        }
        if (!(await checkAvailability('email', email))) {
          setError('Use another email address or sign in to the existing account.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Password confirmation does not match. Check both fields and try again.');
          return;
        }

        const result = await authClient.signUp.email({ name: requestedUsername, email, password, callbackURL });
        if (result.error !== null) {
          setError(errorMessage(result.error));
        } else {
          setNotice(`We sent a 6-digit verification code to ${email}.`);
          setVerificationEmail(email);
          setVerificationCode('');
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
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: verificationEmail,
        type: 'email-verification',
      });
      if (result.error !== null) setError(errorMessage(result.error));
      else {
        setVerificationCode('');
        setNotice('A new verification code is on its way. It expires in 10 minutes.');
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function verifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = verificationCode.trim();
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the 6-digit verification code from your email.');
      return;
    }

    setPending(true);
    setError('');
    try {
      const result = await authClient.emailOtp.verifyEmail({
        email: verificationEmail,
        otp,
      });
      if (result.error !== null) {
        setError(errorMessage(result.error));
        return;
      }
      window.location.assign(callbackURL);
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
    setVerificationCode('');
    setUsername('');
    setEmail('');
    setAvailability({ username: EMPTY_AVAILABILITY, email: EMPTY_AVAILABILITY });
  }

  function availabilityMessage(field: AvailabilityField) {
    const result = availability[field];
    if (result.state === 'idle') return null;
    const Icon = result.state === 'checking'
      ? LoaderCircle
      : result.state === 'available'
        ? CheckCircle2
        : XCircle;
    return (
      <small
        id={`auth-${field}-feedback`}
        className={`field-feedback field-feedback--${result.state}`}
        aria-live="polite"
      >
        <Icon aria-hidden="true" className={result.state === 'checking' ? 'field-feedback__spinner' : undefined} />
        <span>{result.state === 'checking' ? 'Checking availability…' : result.message}</span>
      </small>
    );
  }

  return (
    <section className="auth-panel" aria-labelledby="auth-form-title">
      <div className="auth-panel__head">
        <span className="auth-panel__icon" aria-hidden="true"><UserRound /></span>
        <h2 id="auth-form-title">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>
      </div>

      {error !== '' && <AuthFeedback tone="error">{error}</AuthFeedback>}
      {notice !== '' && <AuthFeedback tone="info">{notice}</AuthFeedback>}

      {verificationEmail !== '' ? (
        <div className="auth-verification">
          <form className="auth-code-form" noValidate onSubmit={verifyEmailCode}>
            <label htmlFor="auth-verification-code">Verification code</label>
            <input
              id="auth-verification-code"
              name="verificationCode"
              type="text"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              aria-describedby="verification-code-help"
              required
            />
            <small id="verification-code-help" className="field-help">Enter the 6-digit code from your email.</small>
            <Button className="auth-submit" type="submit" isDisabled={pending}>
              {pending ? 'Verifying…' : 'Verify email'}
            </Button>
          </form>
          <Button color="secondary" type="button" onPress={resendVerification} isDisabled={pending}>
            Resend code
          </Button>
          <Button className="auth-text-button" color="link" type="button" onPress={() => switchMode('sign-in')}>
            Use a different account
          </Button>
        </div>
      ) : (
        <form className="auth-form" noValidate onSubmit={submit}>
          {mode === 'sign-up' && (
            <div>
              <label htmlFor="auth-username">Username</label>
              <input
                id="auth-username"
                name="username"
                type="text"
                value={username}
                onChange={(event) => updateAvailabilityField('username', event.target.value)}
                onBlur={() => void checkAvailability('username', username)}
                autoComplete="username"
                minLength={3}
                maxLength={30}
                pattern="[A-Za-z0-9_.]{3,30}"
                aria-describedby={`auth-username-help${availability.username.state !== 'idle' ? ' auth-username-feedback' : ''}`}
                required
              />
              <small id="auth-username-help" className="field-help">3–30 letters, numbers, underscores, or periods.</small>
              {availabilityMessage('username')}
            </div>
          )}
          <div>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => updateAvailabilityField('email', event.target.value)}
              onBlur={() => {
                if (mode === 'sign-up') void checkAvailability('email', email);
              }}
              autoComplete="email"
              maxLength={254}
              aria-describedby={mode === 'sign-up' && availability.email.state !== 'idle' ? 'auth-email-feedback' : undefined}
              required
            />
            {mode === 'sign-up' && availabilityMessage('email')}
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
          Local email mode is active. Verification codes and reset links print in the dev-server terminal.
        </p>
      )}
    </section>
  );
}
