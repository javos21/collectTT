import { NextResponse } from 'next/server';

import { currentUser } from '@/lib/session';
import { deleteImage, getImage, imageVariants } from '@/services/images';
import { presignDownload } from '@/lib/storage';

const VARIANTS = new Set(['thumb', 'card', 'full']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const image = await getImage(id);
  if (image === null) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

  const requested = new URL(request.url).searchParams.get('variant') ?? 'full';
  const variant = VARIANTS.has(requested) ? requested : 'full';
  const variants = imageVariants(image.variants);
  const key = variants[variant] ?? variants.full ?? variants.card ?? variants.thumb ?? image.r2KeyOriginal;

  try {
    const url = await presignDownload(key);
    return NextResponse.redirect(url, {
      status: 307,
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch {
    return NextResponse.json({ error: 'Image is not available' }, { status: 404 });
  }
}

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
