/**
 * image:process — generate responsive variants with sharp.
 *
 * Runs in the WORKER process, never the web process: image processing is CPU-bound and
 * would block request handling. The browser uploaded straight to object storage via a
 * presigned PUT, so this task is the first time the bytes touch our code.
 *
 * IDEMPOTENT: guarded on `status = 'pending'`, so a retry after a partial failure
 * regenerates cleanly and a duplicate delivery does nothing.
 */

import sharp from 'sharp';
import { eq, and, sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db } from '../../db/client';
import { images } from '../../db/schema/images';
import { getObject, putObject, variantKey } from '../../lib/storage';

/**
 * Three sizes, no deep zoom (that is a "later" item). Widths chosen for a gallery of
 * detail-heavy items — foil cards, comic covers — on phones over Trinidadian mobile data.
 */
const VARIANTS = [
  { name: 'thumb', width: 320 },
  { name: 'card', width: 800 },
  { name: 'full', width: 1600 },
] as const;

interface Payload {
  imageId: string;
}

export async function processImage(payload: Payload, helpers: Helpers): Promise<void> {
  const { imageId } = payload;

  // ★ Idempotency guard: claim the row only if it is still pending.
  const claimed = await db
    .update(images)
    .set({ status: 'processing' })
    .where(and(eq(images.id, imageId), eq(images.status, 'pending')))
    .returning({ id: images.id, key: images.r2KeyOriginal });

  const row = claimed[0];
  if (row === undefined) {
    helpers.logger.info(`image ${imageId} is not pending — nothing to do`);
    return;
  }

  try {
    const original = await getObject(row.key);
    const meta = await sharp(original).metadata();

    const variants: Record<string, { key: string; w: number; h: number }> = {};

    for (const variant of VARIANTS) {
      // Never upscale — a small original stays small rather than becoming blurry.
      const targetWidth = Math.min(variant.width, meta.width ?? variant.width);

      const output = await sharp(original)
        .rotate() // honour EXIF orientation; phone photos are the common case
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });

      const key = variantKey(imageId, variant.name, 'webp');
      await putObject({ key, body: output.data, contentType: 'image/webp' });

      variants[variant.name] = {
        key,
        w: output.info.width,
        h: output.info.height,
      };
    }

    await db
      .update(images)
      .set({
        status: 'ready',
        variants,
        width: meta.width ?? null,
        height: meta.height ?? null,
        contentType: meta.format !== undefined ? `image/${meta.format}` : null,
        bytes: original.byteLength,
        processedAt: sql`now()`,
      })
      .where(eq(images.id, imageId));

    helpers.logger.info(`image ${imageId} processed into ${VARIANTS.length} variants`);
  } catch (error) {
    // Release the row so a retry can pick it up again rather than stranding it
    // in 'processing' forever.
    await db.update(images).set({ status: 'pending' }).where(eq(images.id, imageId));
    throw error;
  }
}
