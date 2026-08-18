/**
 * Image upload endpoints.
 *
 *   POST /api/images         -> reserve a row, return a presigned PUT URL
 *   PUT  <presigned url>     -> browser uploads bytes DIRECTLY to storage (not here)
 *   POST /api/images/confirm -> queue variant generation in the worker
 *
 * The web process never handles image bytes, which is what keeps a 512MB Render
 * Starter instance comfortable while serving a gallery-heavy app.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentUser } from '@/lib/session';
import { createUploadTicket } from '@/services/images';

const bodySchema = z.object({
  contentType: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
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
