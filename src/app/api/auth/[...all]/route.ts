import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';
import {
  AUTH_RATE_LIMITS,
  enforceAuthRateLimit,
  RateLimitExceeded,
} from '@/lib/rate-limit';
import { hasAcceptedTerms } from '@/lib/legal';

const handler = toNextJsHandler(auth);

type AuthRule = {
  scope: string;
  rule: (typeof AUTH_RATE_LIMITS)[keyof typeof AUTH_RATE_LIMITS];
  readIdentity: boolean;
};

function authRuleFor(request: Request): AuthRule | null {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/auth/, '') || '/';

  if (request.method === 'POST') {
    if (path === '/sign-in/email' || path === '/sign-in/email-otp') {
      return { scope: 'sign-in', rule: AUTH_RATE_LIMITS.signIn, readIdentity: true };
    }
    if (path === '/sign-up/email') {
      return { scope: 'sign-up', rule: AUTH_RATE_LIMITS.signUp, readIdentity: true };
    }
    if (
      path === '/send-verification-email' ||
      path === '/email-otp/send-verification-otp'
    ) {
      return { scope: 'verification-send', rule: AUTH_RATE_LIMITS.verificationSend, readIdentity: true };
    }
    if (
      path === '/email-otp/check-verification-otp' ||
      path === '/email-otp/verify-email'
    ) {
      return { scope: 'verification-check', rule: AUTH_RATE_LIMITS.verificationCheck, readIdentity: true };
    }
    if (
      path === '/request-password-reset' ||
      path === '/email-otp/request-password-reset' ||
      path === '/forget-password/email-otp'
    ) {
      return { scope: 'password-reset-request', rule: AUTH_RATE_LIMITS.passwordResetRequest, readIdentity: true };
    }
    if (path === '/reset-password' || path === '/email-otp/reset-password') {
      return { scope: 'password-reset', rule: AUTH_RATE_LIMITS.passwordReset, readIdentity: false };
    }
  }

  if (
    request.method === 'GET' &&
    (path.startsWith('/reset-password/') || path === '/verify-email')
  ) {
    const isVerification = path === '/verify-email';
    return {
      scope: isVerification ? 'verification-check' : 'password-reset',
      rule: isVerification ? AUTH_RATE_LIMITS.verificationCheck : AUTH_RATE_LIMITS.passwordReset,
      readIdentity: false,
    };
  }

  return null;
}

async function requestEmail(request: Request): Promise<string | undefined> {
  try {
    const body: unknown = await request.clone().json();
    if (typeof body !== 'object' || body === null || !('email' in body)) return undefined;
    const email = body.email;
    return typeof email === 'string' && email.trim() !== '' ? email : undefined;
  } catch {
    return undefined;
  }
}

async function enforceAuthRequestLimit(request: Request): Promise<Response | null> {
  const match = authRuleFor(request);
  if (match === null) return null;

  try {
    await enforceAuthRateLimit(
      match.scope,
      match.readIdentity ? await requestEmail(request) : undefined,
      match.rule,
    );
    return null;
  } catch (error) {
    if (!(error instanceof RateLimitExceeded)) throw error;
    return Response.json(
      { message: error.message },
      { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
    );
  }
}

async function rejectMemberNameChange(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/auth/, '') || '/';
  if (request.method !== 'POST' || path !== '/update-user') return null;

  const body: unknown = await request.clone().json().catch(() => null);
  if (typeof body !== 'object' || body === null || !Object.prototype.hasOwnProperty.call(body, 'name')) return null;

  return Response.json(
    { message: 'Account names are managed by CollectTT and cannot be changed here.' },
    { status: 403 },
  );
}

async function requireTermsAcceptance(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/auth/, '') || '/';
  if (request.method !== 'POST' || path !== '/sign-up/email') return null;

  const body: unknown = await request.clone().json().catch(() => null);
  if (hasAcceptedTerms(body)) return null;

  return Response.json(
    {
      code: 'TERMS_ACCEPTANCE_REQUIRED',
      message: 'You must accept the current CollectTT Terms of Service before creating an account.',
    },
    { status: 400 },
  );
}

export async function GET(request: Request) {
  const rejected = await enforceAuthRequestLimit(request);
  return rejected ?? handler.GET(request);
}

export async function POST(request: Request) {
  const nameChangeRejected = await rejectMemberNameChange(request);
  if (nameChangeRejected !== null) return nameChangeRejected;
  const rejected = await enforceAuthRequestLimit(request);
  if (rejected !== null) return rejected;
  const termsRejected = await requireTermsAcceptance(request);
  return termsRejected ?? handler.POST(request);
}
