import { and, desc, eq, inArray } from 'drizzle-orm';

import type { DbOrTx, Tx } from '@/db/client';
import { supportCases, SUPPORT_CASE_STATUSES, SUPPORT_CASE_TARGET_TYPES, type SupportCaseStatus, type SupportCaseTargetType } from '@/db/schema/support-cases';
import { ConflictError, ForbiddenError } from './transactions';
import { recordAnalyticsEvent } from './analytics';

export const SUPPORT_CASE_CATEGORIES = [
  'payment',
  'delivery',
  'item_condition',
  'no_show',
  'account_safety',
  'listing_accuracy',
  'auction_integrity',
  'other',
] as const;
export type SupportCaseCategory = (typeof SUPPORT_CASE_CATEGORIES)[number];

export function isSupportCaseTargetType(value: string): value is SupportCaseTargetType {
  return (SUPPORT_CASE_TARGET_TYPES as readonly string[]).includes(value);
}

export function isSupportCaseStatus(value: string): value is SupportCaseStatus {
  return (SUPPORT_CASE_STATUSES as readonly string[]).includes(value);
}

export function isSupportCaseCategory(value: string): value is SupportCaseCategory {
  return (SUPPORT_CASE_CATEGORIES as readonly string[]).includes(value);
}

export function validSupportCaseDetail(value: string): boolean {
  return value.trim().length >= 10 && value.trim().length <= 4000;
}

export async function createSupportCase(input: {
  tx: Tx;
  targetType: SupportCaseTargetType;
  targetId: string;
  reporterUserId: string;
  category: SupportCaseCategory;
  detail: string;
  evidence?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const detail = input.detail.trim();
  if (!isSupportCaseTargetType(input.targetType) || input.targetId.trim() === '') throw new ConflictError('Choose a valid support target.');
  if (!isSupportCaseCategory(input.category)) throw new ConflictError('Choose a valid support category.');
  if (!validSupportCaseDetail(detail)) throw new ConflictError('Describe the issue in 10 to 4,000 characters.');

  const existing = await input.tx.select({ id: supportCases.id }).from(supportCases).where(and(
    eq(supportCases.reporterUserId, input.reporterUserId),
    eq(supportCases.targetType, input.targetType),
    eq(supportCases.targetId, input.targetId),
    inArray(supportCases.status, ['open', 'in_review']),
  )).limit(1);
  if (existing[0] !== undefined) throw new ConflictError('You already have an open support case for this item.');

  const inserted = await input.tx.insert(supportCases).values({
    targetType: input.targetType,
    targetId: input.targetId,
    reporterUserId: input.reporterUserId,
    category: input.category,
    detail,
    evidence: input.evidence ?? {},
  }).returning({ id: supportCases.id });
  const row = inserted[0];
  if (row === undefined) throw new Error('Failed to create support case.');
  await recordAnalyticsEvent(input.tx, {
    eventName: 'support_case_created',
    userId: input.reporterUserId,
    subjectType: input.targetType,
    subjectId: input.targetId,
    metadata: { category: input.category },
    idempotencyKey: `support-case-created:${row.id}`,
  });
  return row;
}

export async function listSupportCases(executor: DbOrTx, statuses?: readonly SupportCaseStatus[]) {
  return executor.select().from(supportCases)
    .where(statuses === undefined || statuses.length === 0 ? undefined : inArray(supportCases.status, [...statuses]))
    .orderBy(desc(supportCases.createdAt));
}

export async function updateSupportCase(input: {
  tx: Tx;
  caseId: string;
  actorUserId: string;
  status: SupportCaseStatus;
  resolution?: string | null;
  internalNotes?: string | null;
  assignedTo?: string | null;
  expectedStatus?: SupportCaseStatus;
}): Promise<{ id: string }> {
  if (!isSupportCaseStatus(input.status)) throw new ConflictError('Choose a valid support status.');
  if (input.resolution !== undefined && input.resolution !== null && !validSupportCaseDetail(input.resolution)) {
    throw new ConflictError('Resolution must be 10 to 4,000 characters.');
  }
  const current = await input.tx.select().from(supportCases).where(eq(supportCases.id, input.caseId)).limit(1);
  const row = current[0];
  if (row === undefined) throw new ConflictError('Support case not found.');
  if (input.expectedStatus !== undefined && row.status !== input.expectedStatus) {
    throw new ConflictError('This support case changed before your update.');
  }
  if (row.status === 'resolved' || row.status === 'dismissed') throw new ConflictError('This support case is already closed.');

  const updated = await input.tx.update(supportCases).set({
    status: input.status,
    resolution: input.resolution === undefined ? row.resolution : input.resolution,
    internalNotes: input.internalNotes === undefined ? row.internalNotes : input.internalNotes,
    assignedTo: input.assignedTo === undefined ? row.assignedTo : input.assignedTo,
    resolvedBy: input.status === 'resolved' || input.status === 'dismissed' ? input.actorUserId : row.resolvedBy,
    resolvedAt: input.status === 'resolved' || input.status === 'dismissed' ? new Date() : row.resolvedAt,
    updatedAt: new Date(),
  }).where(and(eq(supportCases.id, input.caseId), eq(supportCases.status, row.status))).returning({ id: supportCases.id });
  if (updated.length === 0) throw new ConflictError('This support case changed before your update.');
  const result = updated[0];
  if (result === undefined) throw new ConflictError('This support case changed before your update.');
  return result;
}

export function assertSupportCaseParty(input: { targetType: SupportCaseTargetType; reporterUserId: string; buyerId?: string; sellerId?: string }): void {
  if (input.targetType === 'account') return;
  if (input.buyerId !== input.reporterUserId && input.sellerId !== input.reporterUserId) {
    throw new ForbiddenError('Only a participant can report this marketplace item.');
  }
}
