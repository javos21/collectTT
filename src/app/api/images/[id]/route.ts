import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/session';
import { deleteImage } from '@/services/images';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (user === null) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { id } = await params;
  try {
    await deleteImage(id, user.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not remove image.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
