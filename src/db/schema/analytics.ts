/** First-party product events used for funnel and outcome reporting. */

import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { profiles } from './profiles';

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventName: text('event_name').notNull(),
    userId: text('user_id').references(() => profiles.userId, { onDelete: 'set null' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Stable business occurrence key; retries cannot double-count a funnel event. */
    idempotencyKey: text('idempotency_key').notNull(),
  },
  (t) => [
    uniqueIndex('analytics_events_idempotency').on(t.idempotencyKey),
    index('analytics_events_name_time').on(t.eventName, t.occurredAt.desc()),
    index('analytics_events_subject_time').on(t.subjectType, t.subjectId, t.occurredAt.desc()),
  ],
);
