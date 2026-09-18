import type { DbOrTx } from '@/db/client';
import { analyticsEvents } from '@/db/schema/analytics';

export const ANALYTICS_EVENTS = [
  'listing_created',
  'listing_published',
  'reservation_created',
  'bid_placed',
  'transaction_completed',
  'transaction_terminated',
  'support_case_created',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export async function recordAnalyticsEvent(
  tx: DbOrTx,
  input: {
    eventName: AnalyticsEventName;
    userId?: string | null;
    subjectType: string;
    subjectId?: string | null;
    metadata?: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<void> {
  await tx.insert(analyticsEvents).values({
    eventName: input.eventName,
    userId: input.userId ?? null,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    metadata: input.metadata ?? {},
    idempotencyKey: input.idempotencyKey,
  }).onConflictDoNothing({ target: analyticsEvents.idempotencyKey });
}
