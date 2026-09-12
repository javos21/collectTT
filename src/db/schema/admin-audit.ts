/**
 * Append-only record of platform administrator decisions.
 *
 * Domain tables describe what happened to marketplace data. This table describes
 * what an administrator attempted, why, and what the target looked like before
 * and after the action. It deliberately has no update/delete service API.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, jsonb, index } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { adminAuditOutcomeEnum } from './enums';

export const adminAuditEvents = pgTable(
  'admin_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id').references(() => profiles.userId, { onDelete: 'set null' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    outcome: adminAuditOutcomeEnum('outcome').notNull().default('succeeded'),
    beforeContext: jsonb('before_context').notNull().default(sql`'{}'::jsonb`),
    afterContext: jsonb('after_context').notNull().default(sql`'{}'::jsonb`),
    requestMetadata: jsonb('request_metadata').notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('admin_audit_actor_time').on(t.actorUserId, t.occurredAt.desc()),
    index('admin_audit_target_time').on(t.targetType, t.targetId, t.occurredAt.desc()),
    index('admin_audit_action_time').on(t.action, t.occurredAt.desc()),
    index('admin_audit_time').on(t.occurredAt.desc()),
  ],
);
