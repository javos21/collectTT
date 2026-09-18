import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentUser } from '@/lib/session';
import {
  clientAddress,
  enforceRateLimit,
  RATE_LIMITS,
  RateLimitExceeded,
  requestHeaders,
} from '@/lib/rate-limit';
import { confirmUpload } from '@/services/images';

const bodySchema = z.object({
  imageId: z.string().uuid(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  try {
    await enforceRateLimit({
      scope: 'image:confirm:user',
      identity: user.userId,
      ...RATE_LIMITS.upload,
    });
    await enforceRateLimit({
      scope: 'image:confirm:ip',
      identity: clientAddress(await requestHeaders()),
      limit: RATE_LIMITS.upload.limit * 3,
      windowSeconds: RATE_LIMITS.upload.windowSeconds,
    });
  } catch (error) {
    if (error instanceof RateLimitExceeded) {
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { 'Retry-After': String(error.retryAfterSeconds) } },
      );
    }
    throw error;
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'imageId is required' }, { status: 400 });
  }

  try {
    // Queues image:process in the same transaction as the confirmation.
    await confirmUpload(parsed.data.imageId, user.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Confirm failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
