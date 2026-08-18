/**
 * Image intake.
 *
 * The browser uploads straight to object storage with a presigned PUT — the web
 * process never proxies image bytes. Afterwards the client confirms, and the worker
 * generates variants. Two round trips, no large request bodies through Next.js.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { images } from '../db/schema/images';
import { enqueue } from '../jobs/enqueue';
import { originalKey, presignUpload } from '../lib/storage';

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/avif', 'avif'],
]);

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export interface UploadTicket {
  imageId: string;
  uploadUrl: string;
  key: string;
}

/** Step 1: reserve a row and hand back a presigned PUT URL. */
export async function createUploadTicket(
  ownerUserId: string,
  contentType: string,
): Promise<UploadTicket> {
  const ext = ALLOWED.get(contentType);
  if (ext === undefined) {
    throw new Error(`Unsupported image type: ${contentType}. Use JPEG, PNG, WebP or AVIF.`);
  }

  const imageId = randomUUID();
  const key = originalKey(imageId, ext);

  await db.insert(images).values({
    id: imageId,
    ownerUserId,
    status: 'pending',
    r2KeyOriginal: key,
    contentType,
  });

  const uploadUrl = await presignUpload({ key, contentType });
  return { imageId, uploadUrl, key };
}

/**
 * Step 2: the client confirms the upload landed, and we queue variant generation.
 * The enqueue happens in the same transaction as the confirmation, so an image can
 * never be marked uploaded without its processing job existing.
 */
export async function confirmUpload(imageId: string, ownerUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: images.id, owner: images.ownerUserId, status: images.status })
      .from(images)
      .where(eq(images.id, imageId))
      .limit(1);

    const row = rows[0];
    if (row === undefined) throw new Error('Image not found');
    if (row.owner !== ownerUserId) throw new Error('Not your image');
    // Already queued or processed — confirming twice is a no-op, not an error.
    if (row.status !== 'pending') return;

    // ★ Enqueued on the same transaction as the confirmation: an image can never be
    //   confirmed without its processing job existing.
    await enqueue(tx, 'image:process', { imageId }, { jobKey: `image:${imageId}` });
  });
}

export async function getImage(imageId: string) {
  const rows = await db.select().from(images).where(eq(images.id, imageId)).limit(1);
  return rows[0] ?? null;
}

/** Variant URLs for rendering, falling back to the original while processing. */
export function imageVariants(variants: unknown): Record<string, string> {
  if (typeof variants !== 'object' || variants === null) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(variants as Record<string, { key?: string }>)) {
    if (typeof value?.key === 'string') out[name] = value.key;
  }
  return out;
}
