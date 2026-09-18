import { describe, expect, it, vi } from 'vitest';

import {
  clientAddress,
  enforceRateLimit,
  rateLimitKey,
  RateLimitExceeded,
} from '../../src/lib/rate-limit';
import type { DbOrTx } from '../../src/db/client';

describe('application rate-limit primitives', () => {
  it('creates bounded, scope-separated bucket keys', () => {
    expect(rateLimitKey('listing:claim', 'user-123')).toBe('listing:claim:user-123');
    expect(rateLimitKey('listing:claim', 'user-123')).not.toBe(rateLimitKey('listing:bid', 'user-123'));
    expect(rateLimitKey('scope', 'x'.repeat(400)).length).toBeLessThanOrEqual(240);
  });

  it('uses the trusted proxy address and has a safe fallback', () => {
    expect(clientAddress(new Headers({ 'x-forwarded-for': '203.0.113.10, 10.0.0.1' }))).toBe('203.0.113.10');
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.11' }))).toBe('203.0.113.11');
    expect(clientAddress(new Headers())).toBe('unknown');
  });

  it('exposes a retry interval for API and server-action feedback', () => {
    const error = new RateLimitExceeded(17);
    expect(error.name).toBe('RateLimitExceeded');
    expect(error.retryAfterSeconds).toBe(17);
    expect(error.message).toMatch(/too many attempts/i);
  });

  it('fails closed when the atomic database counter is over the configured limit', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        rows: [{ hit_count: '4', retry_after_seconds: '12' }],
      }),
    } as unknown as DbOrTx;

    await expect(enforceRateLimit({
      scope: 'listing:claim:user',
      identity: 'user-1',
      limit: 3,
      windowSeconds: 60,
      executor,
    })).rejects.toMatchObject({ name: 'RateLimitExceeded', retryAfterSeconds: 12 });
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('allows a request while the database counter remains within the limit', async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({ rows: [{ hit_count: 2, retry_after_seconds: 58 }] }),
    } as unknown as DbOrTx;

    await expect(enforceRateLimit({
      scope: 'listing:bid:user',
      identity: 'user-1',
      limit: 3,
      windowSeconds: 60,
      executor,
    })).resolves.toBeUndefined();
  });
});
