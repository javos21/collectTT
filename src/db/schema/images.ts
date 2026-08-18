/**
 * Images. Uploaded straight to object storage via a presigned PUT, then processed
 * asynchronously by the worker (`image:process`) which generates the responsive
 * variants with sharp.
 *
 * `variants` is JSONB rather than a child table: it is display metadata, not
 * integrity-critical data, and the shape genuinely varies as we tune sizes.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, integer, bigint, uuid, jsonb, index } from 'drizzle-orm/pg-core';

import { imageStatusEnum } from './enums';

export const images = pgTable(
  'images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Not FK'd to profiles: profiles references images (avatar), and a cycle here would
    // make both tables uninsertable. Ownership is enforced in the service layer.
    ownerUserId: text('owner_user_id').notNull(),
    status: imageStatusEnum('status').notNull().default('pending'),
    r2KeyOriginal: text('r2_key_original').notNull(),
    /** { thumb: {key,w,h}, card: {key,w,h}, full: {key,w,h} } — written by the worker. */
    variants: jsonb('variants').notNull().default(sql`'{}'::jsonb`),
    contentType: text('content_type'),
    bytes: bigint('bytes', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    checksumSha256: text('checksum_sha256'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('images_owner').on(t.ownerUserId, t.createdAt.desc()),
    index('images_pending')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);
