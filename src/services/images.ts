/**
 * Image intake.
 *
 * The browser uploads straight to object storage with a presigned PUT — the web
 * process never proxies image bytes. Afterwards the client confirms, and the worker
 * generates variants. Two round trips, no large request bodies through Next.js.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db } from '../db/client';
import { images } from '../db/schema/images';
import { listingImages } from '../db/schema/listings';
import { enqueue } from '../jobs/enqueue';
import { MAX_IMAGE_BYTES, UPLOAD_CONTENT_TYPE } from '../lib/image-policy';
import { deleteObjects, headObject, originalKey, presignUpload } from '../lib/storage';

export { MAX_IMAGE_BYTES } from '../lib/image-policy';

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
  if (contentType !== UPLOAD_CONTENT_TYPE) {
    throw new Error('Images must be compressed to WebP before upload.');
  }

  const imageId = randomUUID();
  const key = originalKey(imageId);

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
  const rows = await db
    .select({ id: images.id, owner: images.ownerUserId, status: images.status, key: images.r2KeyOriginal })
    .from(images)
    .where(eq(images.id, imageId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error('Image not found');
  if (row.owner !== ownerUserId) throw new Error('Not your image');
  // Already queued or processed — confirming twice is a no-op, not an error.
  if (row.status !== 'pending') return;

  let stored: Awaited<ReturnType<typeof headObject>>;
  try {
    stored = await headObject(row.key);
  } catch {
    throw new Error('Uploaded image could not be found in storage.');
  }

  if (stored.contentLength === undefined || stored.contentLength <= 0) {
    throw new Error('Uploaded image is empty.');
  }
  if (stored.contentLength > MAX_IMAGE_BYTES) {
    throw new Error('Compressed image is too large.');
  }
  if (stored.contentType?.toLowerCase() !== UPLOAD_CONTENT_TYPE) {
    throw new Error('Uploaded image must be a WebP file.');
  }

  await db.transaction(async (tx) => {
    const current = await tx
      .select({ owner: images.ownerUserId, status: images.status })
      .from(images)
      .where(eq(images.id, imageId))
      .limit(1);

    const latest = current[0];
    if (latest === undefined) throw new Error('Image not found');
    if (latest.owner !== ownerUserId) throw new Error('Not your image');
    if (latest.status !== 'pending') return;

    // Enqueued on the same transaction as confirmation: an image can never be
    // confirmed without its processing job existing.
    await enqueue(tx, 'image:process', { imageId }, { jobKey: `image:${imageId}` });
  });
}

/** Remove an unassociated upload and all of its generated objects. */
export async function deleteImage(imageId: string, ownerUserId: string): Promise<void> {
  const rows = await db
    .select({ id: images.id, owner: images.ownerUserId, status: images.status, sourceKey: images.r2KeyOriginal, variants: images.variants })
    .from(images)
    .where(and(eq(images.id, imageId), eq(images.ownerUserId, ownerUserId)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) throw new Error('Image not found');
  if (row.status === 'processing') throw new Error('Image is still processing. Try again shortly.');

  const linked = await db
    .select({ listingId: listingImages.listingId })
    .from(listingImages)
    .where(eq(listingImages.imageId, imageId))
    .limit(1);
  if (linked[0] !== undefined) throw new Error('Images already attached to a listing cannot be removed.');

  await deleteObjects([row.sourceKey, ...Object.values(imageVariants(row.variants))]);
  await db.delete(images).where(eq(images.id, imageId));
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
