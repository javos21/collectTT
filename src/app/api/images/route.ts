/**
 * Image upload endpoints.
 *
 *   POST /api/images         -> reserve a row, return a presigned PUT URL for WebP bytes
 *   PUT  <presigned url>     -> browser uploads bytes DIRECTLY to storage (not here)
 *   POST /api/images/confirm -> queue variant generation in the worker
 *
 * The web process never handles image bytes, which is what keeps a 512MB Render
 * Starter instance comfortable while serving a gallery-heavy app.
 */

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
import { createUploadTicket } from '@/services/images';

const bodySchema = z.object({
  contentType: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }

  try {
    await enforceRateLimit({
      scope: 'image:upload:user',
      identity: user.userId,
      ...RATE_LIMITS.upload,
    });
    await enforceRateLimit({
      scope: 'image:upload:ip',
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
    return NextResponse.json({ error: 'contentType is required' }, { status: 400 });
  }

  try {
    const ticket = await createUploadTicket(user.userId, parsed.data.contentType);
    return NextResponse.json(ticket);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
