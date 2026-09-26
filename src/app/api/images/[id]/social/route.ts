import { NextResponse } from 'next/server';

import { getObject } from '@/lib/storage';
import { getImage, imageVariants } from '@/services/images';

function detectedContentType(body: Buffer, fallback: string): string {
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (body.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (body.subarray(4, 12).toString('ascii').includes('ftypavif')) return 'image/avif';
  return fallback;
}

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
  const storedContentType = key === image.r2KeyOriginal ? image.contentType ?? 'image/webp' : 'image/webp';

  try {
    const body = await getObject(key);
    const contentType = detectedContentType(body, storedContentType);
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
