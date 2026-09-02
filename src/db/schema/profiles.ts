/**
 * Domain identity, reputation and restrictions.
 *
 * `profiles` is separate from Better Auth's `user` table so authentication is
 * swappable without dragging the trust data — which is the one thing in this system
 * that genuinely cannot be lost — along with it.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
  jsonb,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth';
import { images } from './images';
import {
  userRoleEnum,
  userStatusEnum,
  reputationEventTypeEnum,
  restrictionTypeEnum,
  restrictionSourceEnum,
} from './enums';

export const profiles = pgTable(
  'profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    handle: text('handle').notNull(),
    phoneE164: text('phone_e164'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    avatarImageId: uuid('avatar_image_id').references(() => images.id, { onDelete: 'set null' }),
    bio: text('bio'),
    area: text('area'),
    deliveryAddressLine1: text('delivery_address_line_1'),
    deliveryAddressLine2: text('delivery_address_line_2'),
    deliveryCity: text('delivery_city'),
    deliveryCountry: text('delivery_country').notNull().default('Trinidad and Tobago'),
    role: userRoleEnum('role').notNull().default('member'),
    status: userStatusEnum('status').notNull().default('active'),
    memberSince: timestamp('member_since', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('profiles_handle_key').on(sql`lower(${t.handle})`),
    uniqueIndex('profiles_phone_key')
      .on(t.phoneE164)
      .where(sql`${t.phoneE164} is not null`),
  ],
);

/**
 * APPEND-ONLY source of truth for every objective fact about a member.
 * Never updated, never deleted. Counters below are a cache of this table.
 */
export const reputationEvents = pgTable(
  'reputation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.userId),
    counterpartyUserId: text('counterparty_user_id').references(() => profiles.userId),
    // FK to transactions is added in a follow-up migration statement to avoid a
    // circular import between these two schema modules.
    transactionId: uuid('transaction_id'),
    type: reputationEventTypeEnum('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    // ★ IDEMPOTENCY. A retried job physically cannot double-count a fact.
    uniqueIndex('reputation_events_idem')
      .on(t.transactionId, t.userId, t.type)
      .where(sql`${t.transactionId} is not null`),
    index('reputation_events_user_time').on(t.userId, t.occurredAt.desc()),
  ],
);

/**
 * Denormalized cache of `reputation_events`. Fully rebuildable at any time — the
 * nightly `reputation:recompute` task does exactly that for the rolling windows.
 */
export const reputationCounters = pgTable('reputation_counters', {
  userId: text('user_id')
    .primaryKey()
    .references(() => profiles.userId, { onDelete: 'cascade' }),

  buyClaimsTotal: integer('buy_claims_total').notNull().default(0),
  buyCompleted: integer('buy_completed').notNull().default(0),
  buyRenegedTotal: integer('buy_reneged_total').notNull().default(0),
  buyReneged90d: integer('buy_reneged_90d').notNull().default(0),
  buyPaidOnTime: integer('buy_paid_on_time').notNull().default(0),
  buyNoShows: integer('buy_no_shows').notNull().default(0),

  sellListingsResolved: integer('sell_listings_resolved').notNull().default(0),
  sellCompleted: integer('sell_completed').notNull().default(0),
  sellRenegedTotal: integer('sell_reneged_total').notNull().default(0),
  sellReneged90d: integer('sell_reneged_90d').notNull().default(0),
  sellNoShows: integer('sell_no_shows').notNull().default(0),

  recomputedAt: timestamp('recomputed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const restrictions = pgTable(
  'restrictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    type: restrictionTypeEnum('type').notNull(),
    source: restrictionSourceEnum('source').notNull(),
    reason: text('reason').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('restrictions_active')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.liftedAt} is null`),
  ],
);
