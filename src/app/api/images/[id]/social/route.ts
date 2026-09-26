import { NextResponse } from 'next/server';

import { getObject } from '@/lib/storage';
import { getImage, imageVariants } from '@/services/images';

/** Stable, cookie-free image bytes for Open Graph crawlers. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const image = await getImage(id);
  if (image === null) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

  const variants = imageVariants(image.variants);
  const key = variants.full ?? variants.card ?? variants.thumb ?? image.r2KeyOriginal;
  const contentType = key === image.r2KeyOriginal ? image.contentType ?? 'image/webp' : 'image/webp';

  try {
    const body = await getObject(key);
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(body.byteLength),
        'Cache-Control': image.status === 'ready'
          ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000'
          : 'public, max-age=60, s-maxage=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image is not available' }, { status: 404 });
  }
}
