/**
 * Contextual support reports across the marketplace. Reporter identity is stored for
 * staff only; no member-facing query should join this table.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';

export const supportCases = pgTable(
  'support_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reporterUserId: text('reporter_user_id').notNull().references(() => profiles.userId),
    category: text('category').notNull(),
    detail: text('detail').notNull(),
    evidence: jsonb('evidence').notNull().default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('open'),
    assignedTo: text('assigned_to').references(() => profiles.userId, { onDelete: 'set null' }),
    internalNotes: text('internal_notes'),
    resolution: text('resolution'),
    resolvedBy: text('resolved_by').references(() => profiles.userId, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('support_cases_target_type_valid', sql`${t.targetType} in ('listing', 'auction', 'transaction', 'account')`),
    check('support_cases_status_valid', sql`${t.status} in ('open', 'in_review', 'resolved', 'dismissed')`),
    check('support_cases_category_nonempty', sql`length(trim(${t.category})) between 2 and 80`),
    check('support_cases_detail_length', sql`length(trim(${t.detail})) between 10 and 4000`),
    index('support_cases_queue').on(t.status, t.createdAt.desc()),
    index('support_cases_target').on(t.targetType, t.targetId, t.createdAt.desc()),
    index('support_cases_reporter').on(t.reporterUserId, t.createdAt.desc()),
    uniqueIndex('support_cases_one_open_per_reporter_target').on(t.reporterUserId, t.targetType, t.targetId).where(sql`${t.status} in ('open', 'in_review')`),
  ],
);

export const SUPPORT_CASE_TARGET_TYPES = ['listing', 'auction', 'transaction', 'account'] as const;
export type SupportCaseTargetType = (typeof SUPPORT_CASE_TARGET_TYPES)[number];
export const SUPPORT_CASE_STATUSES = ['open', 'in_review', 'resolved', 'dismissed'] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

