import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentUser } from '@/lib/session';
import { confirmUpload } from '@/services/images';

const bodySchema = z.object({
  imageId: z.string().uuid(),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
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
