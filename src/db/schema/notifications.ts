/**
 * Channel-agnostic notifications.
 *
 * One dispatch job, pluggable adapters. `in_app` and `email` ship now; `whatsapp` is
 * already a legal channel value so adding it later is one adapter file and zero
 * changes at any call site. That is the whole point of the seam.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { transactions } from './transactions';
import {
  notificationChannelEnum,
  deliveryStatusEnum,
  disputeReasonEnum,
  disputeStatusEnum,
} from './enums';

/** The in-app inbox. Also the fallback record when every other channel fails. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    linkUrl: text('link_url'),
    data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_unread')
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} is null`),
  ],
);

/** One row per (logical event × channel). The adapters read from here. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Groups the channels of a single logical event. */
    eventId: uuid('event_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    payload: jsonb('payload').notNull(),
    /** ★ Job-retry idempotency. A replayed dispatch cannot send twice. */
    dedupeKey: text('dedupe_key').notNull(),
    providerMessageId: text('provider_message_id'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('notification_deliveries_dedupe').on(t.dedupeKey),
    index('notification_deliveries_pending')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => profiles.userId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType, t.channel] })],
);

/**
 * The pressure valve for everything software cannot verify — a shipment that never
 * arrived, a seller who would not hand over, an item not as described. Phase 2, but
 * the table exists now because several terminal paths want to reference it.
 */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    raisedBy: text('raised_by')
      .notNull()
      .references(() => profiles.userId),
    reason: disputeReasonEnum('reason').notNull(),
    status: disputeStatusEnum('status').notNull().default('open'),
    detail: text('detail').notNull(),
    resolution: text('resolution'),
    resolvedBy: text('resolved_by').references(() => profiles.userId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('disputes_open')
      .on(t.createdAt.desc())
      .where(sql`${t.status} = 'open'`),
    index('disputes_by_tx').on(t.transactionId),
  ],
);
