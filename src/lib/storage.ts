/**
 * Object storage. ONE S3 client, endpoint from env.
 *
 *   local       -> MinIO   (docker compose, no account needed)
 *   production  -> Cloudflare R2 (zero egress fees, the big cost lever for a
 *                                 gallery-heavy app)
 *
 * Both speak S3, so moving from one to the other is credentials — never code.
 * That is why the whole upload → variant pipeline can be developed offline.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

let client: S3Client | null = null;

export function storage(): S3Client {
  if (client !== null) return client;
  const e = env();
  client = new S3Client({
    region: e.STORAGE_REGION,
    endpoint: e.STORAGE_ENDPOINT,
    forcePathStyle: e.STORAGE_FORCE_PATH_STYLE, // MinIO needs this; R2 tolerates it
    credentials: {
      accessKeyId: e.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export function bucket(): string {
  return env().STORAGE_BUCKET;
}

/** Public URL for a stored object. MinIO locally, the R2 CDN domain in production. */
export function publicUrl(key: string): string {
  return `${env().STORAGE_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
}

/**
 * Presigned PUT so the browser uploads straight to storage and the web process never
 * proxies image bytes. The worker picks the object up afterwards for variant generation.
 */
export async function presignUpload(opts: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: opts.key,
    ContentType: opts.contentType,
  });
  return getSignedUrl(storage(), command, { expiresIn: opts.expiresInSeconds ?? 600 });
}

export async function putObject(opts: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await storage().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const result = await storage().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (result.Body === undefined) throw new Error(`Object not found: ${key}`);
  const chunks: Uint8Array[] = [];
  // @ts-expect-error - Body is a Node Readable stream in the Node runtime
  for await (const chunk of result.Body) {
    chunks.push(chunk as Uint8Array);
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(key: string): Promise<void> {
  await storage().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/** Deterministic key layout, so an object's purpose is readable from its path. */
export function originalKey(imageId: string, ext: string): string {
  return `originals/${imageId}.${ext}`;
}

export function variantKey(imageId: string, variant: string, ext: string): string {
  return `variants/${imageId}/${variant}.${ext}`;
}
