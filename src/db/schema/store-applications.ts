import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { relayStores } from './custody';
import { profiles } from './profiles';
import { sizeClassEnum, storeApplicationStatusEnum } from './enums';

/** A versioned record of a user's request to operate a physical Store. */
export const storeApplications = pgTable(
  'store_applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicantId: text('applicant_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    storeName: text('store_name').notNull(),
    addressLine1: text('address_line_1').notNull(),
    addressLine2: text('address_line_2'),
    area: text('area').notNull(),
    city: text('city').notNull(),
    country: text('country').notNull().default('Trinidad and Tobago'),
    phoneE164: text('phone_e164').notNull(),
    websiteUrl: text('website_url'),
    instagramUrl: text('instagram_url'),
    facebookUrl: text('facebook_url'),
    tiktokUrl: text('tiktok_url'),
    acceptsSizeClasses: sizeClassEnum('accepts_size_classes').array().notNull(),
    termsVersion: text('terms_version').notNull(),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull().defaultNow(),
    status: storeApplicationStatusEnum('status').notNull().default('pending'),
    adminNote: text('admin_note'),
    reviewedBy: text('reviewed_by').references(() => profiles.userId, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    storeId: uuid('store_id').references(() => relayStores.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A user may have one application in flight or one confirmed Store. Declined
    // applications remain as an audit trail and may be resubmitted.
    uniqueIndex('store_applications_one_active')
      .on(t.applicantId)
      .where(sql`${t.status} in ('pending', 'confirmed')`),
    index('store_applications_status_created_at').on(t.status, t.createdAt.desc()),
  ],
);
