import { beforeEach, describe, expect, it, vi } from 'vitest';

const enforceAuthRateLimit = vi.hoisted(() => vi.fn());
const delegatedGet = vi.hoisted(() => vi.fn().mockResolvedValue(new Response('ok')));
const delegatedPost = vi.hoisted(() => vi.fn().mockResolvedValue(new Response('ok')));

class MockRateLimitExceeded extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many attempts');
    this.name = 'RateLimitExceeded';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: () => ({ GET: delegatedGet, POST: delegatedPost }),
}));
vi.mock('@/lib/auth', () => ({ auth: {} }));
vi.mock('@/lib/rate-limit', () => ({
  AUTH_RATE_LIMITS: {
    signIn: { limit: 10, windowSeconds: 300, ipLimit: 30 },
    signUp: { limit: 5, windowSeconds: 900, ipLimit: 15 },
    verificationSend: { limit: 3, windowSeconds: 600, ipLimit: 15 },
    verificationCheck: { limit: 10, windowSeconds: 600, ipLimit: 30 },
    passwordResetRequest: { limit: 5, windowSeconds: 900, ipLimit: 15 },
    passwordReset: { limit: 10, windowSeconds: 900, ipLimit: 30 },
  },
  enforceAuthRateLimit,
  RateLimitExceeded: MockRateLimitExceeded,
}));

const { GET, POST } = await import('../../src/app/api/auth/[...all]/route');

describe('authentication rate-limit boundary', () => {
  beforeEach(() => {
    enforceAuthRateLimit.mockReset();
    delegatedGet.mockClear();
    delegatedPost.mockClear();
  });

  it('limits sign-in by IP and normalized email before Better Auth runs', async () => {
    const request = new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'USER@Example.com', password: 'not-used' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(enforceAuthRateLimit).toHaveBeenCalledWith(
      'sign-in',
      'USER@Example.com',
      { limit: 10, windowSeconds: 300, ipLimit: 30 },
    );
    expect(delegatedPost).toHaveBeenCalledWith(request);
  });

  it('limits reset-link callbacks by IP even when no email is present', async () => {
    const request = new Request('http://localhost/api/auth/reset-password/token-123', { method: 'GET' });

    await GET(request);

    expect(enforceAuthRateLimit).toHaveBeenCalledWith(
      'password-reset',
      undefined,
      { limit: 10, windowSeconds: 900, ipLimit: 30 },
    );
    expect(delegatedGet).toHaveBeenCalledWith(request);
  });

  it('limits verification-link callbacks by IP', async () => {
    const request = new Request('http://localhost/api/auth/verify-email?token=token-123', { method: 'GET' });

    await GET(request);

    expect(enforceAuthRateLimit).toHaveBeenCalledWith(
      'verification-check',
      undefined,
      { limit: 10, windowSeconds: 600, ipLimit: 30 },
    );
  });

  it('returns 429 with Retry-After and does not call Better Auth when blocked', async () => {
    enforceAuthRateLimit.mockRejectedValue(new MockRateLimitExceeded(37));
    const request = new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com' }),
    });

    const response = await POST(request);

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('37');
    expect(delegatedPost).not.toHaveBeenCalled();
  });

  it('does not rate-limit unrelated authenticated session reads', async () => {
    const request = new Request('http://localhost/api/auth/get-session', { method: 'GET' });

    await GET(request);

    expect(enforceAuthRateLimit).not.toHaveBeenCalled();
    expect(delegatedGet).toHaveBeenCalledWith(request);
  });
});
