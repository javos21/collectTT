import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { clientAddress, enforceRateLimit, RATE_LIMITS, RateLimitExceeded, requestHeaders } from '@/lib/rate-limit';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: Record<string, unknown>, init?: ResponseInit) {
  return Response.json(data, {
    headers: { 'Cache-Control': 'no-store' },
    ...init,
  });
}

export async function GET(request: Request) {
  try {
    await enforceRateLimit({
      scope: 'auth:availability:ip',
      identity: clientAddress(await requestHeaders()),
      ...RATE_LIMITS.availability,
    });
  } catch (error) {
    if (error instanceof RateLimitExceeded) {
      return json(
        { message: error.message },
        { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }

  const params = new URL(request.url).searchParams;
  const field = params.get('field');
  const rawValue = params.get('value') ?? '';

  if (field !== 'email') {
    return json({ message: 'Choose a valid field to check.' }, { status: 400 });
  }

  const value = rawValue.trim().toLowerCase();
  const isValid = EMAIL_PATTERN.test(value);
  if (!isValid) {
    return json({ available: false, message: `Enter a valid ${field}.` }, { status: 400 });
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${value}`)
    .limit(1);

  return json({ available: existing[0] === undefined });
}
