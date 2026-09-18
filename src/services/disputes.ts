/**
 * Member-submitted dispute records.
 *
 * A dispute is a support work item and a pause signal. The transaction's dispute
 * track freezes automated transitions while the payment/custody tracks remain intact.
 */

import { and, eq, or, sql } from 'drizzle-orm';

import type { Tx } from '@/db/client';
import { disputes } from '@/db/schema/notifications';
import { transactionEvents, transactions } from '@/db/schema/transactions';
import { notify } from '@/notifications/dispatch';
import { ConflictError, ForbiddenError } from './transactions';
import { loadTransaction } from './transactions';
import { createSupportCase, type SupportCaseCategory } from './support-cases';

export const DISPUTE_REASONS = [
  'payment_not_received',
  'item_not_received',
  'item_not_as_described',
  'no_show',
  'other',
] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export const DISPUTE_REASON_LABELS: Record<DisputeReason, string> = {
  payment_not_received: 'Payment was not received',
  item_not_received: 'Item was not received',
  item_not_as_described: 'Item was not as described',
  no_show: 'The other member did not show up',
  other: 'Something else went wrong',
};

export function isDisputeReason(value: string): value is DisputeReason {
  return (DISPUTE_REASONS as readonly string[]).includes(value);
}

export function validDisputeDetail(value: string): boolean {
  return value.length >= 10 && value.length <= 2000;
}

export async function submitDispute(input: {
  tx: Tx;
  transactionId: string;
  raisedBy: string;
  reason: DisputeReason;
  detail: string;
}): Promise<{ id: string }> {
  const detail = input.detail.trim();
  if (!validDisputeDetail(detail)) {
    throw new ConflictError('Describe the issue in 10 to 2,000 characters.');
  }

  const transaction = await loadTransaction(input.tx, input.transactionId);
  if (transaction.buyerId !== input.raisedBy && transaction.sellerId !== input.raisedBy) {
    throw new ForbiddenError('Only a buyer or seller on this deal can submit a dispute.');
  }
  if (transaction.state !== 'open') {
    throw new ConflictError('This deal is already closed.');
  }

  // One open work item per member keeps repeated submissions from flooding the queue.
  // A resolved or dismissed dispute can still be followed by a new report if the
  // problem persists.
  const existing = await input.tx
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(
      eq(disputes.transactionId, input.transactionId),
      eq(disputes.raisedBy, input.raisedBy),
      eq(disputes.status, 'open'),
    ))
    .limit(1);
  if (existing[0] !== undefined) {
    throw new ConflictError('You already have an open dispute for this deal.');
  }

  const inserted = await input.tx
    .insert(disputes)
    .values({
      transactionId: input.transactionId,
      raisedBy: input.raisedBy,
      reason: input.reason,
      detail,
    })
    .returning({ id: disputes.id });
  const created = inserted[0];
  if (created === undefined) throw new Error('Failed to submit dispute');

  const supportCategory: SupportCaseCategory = input.reason === 'payment_not_received'
    ? 'payment'
    : input.reason === 'item_not_received'
      ? 'delivery'
      : input.reason === 'item_not_as_described'
        ? 'item_condition'
        : input.reason === 'no_show'
          ? 'no_show'
          : 'other';
  await createSupportCase({
    tx: input.tx,
    targetType: 'transaction',
    targetId: input.transactionId,
    reporterUserId: input.raisedBy,
    category: supportCategory,
    detail,
    evidence: { source: 'deal_dispute', disputeId: created.id },
  });

  // A report freezes all automatic completion/expiry work. Keep the listing reserved
  // while support reviews it by making DISPUTED a first-class rollup state.
  if (transaction.disputeState !== 'open') {
    const moved = await input.tx.update(transactions).set({ disputeState: 'open', updatedAt: sql`now()` })
      .where(and(eq(transactions.id, input.transactionId), eq(transactions.state, 'open'), or(eq(transactions.disputeState, 'none'), eq(transactions.disputeState, 'resolved'))))
      .returning({ id: transactions.id });
    if (moved.length > 0) {
      await input.tx.insert(transactionEvents).values({
        transactionId: input.transactionId,
        track: 'overall',
        fromState: 'open',
        toState: 'disputed',
        actorUserId: input.raisedBy,
        actorRole: input.raisedBy === transaction.buyerId ? 'buyer' : 'seller',
        reason: input.reason,
        metadata: { disputeId: created.id },
      });
    }
  }

  const counterpartyId = transaction.buyerId === input.raisedBy
    ? transaction.sellerId
    : transaction.buyerId;
  await notify({
    tx: input.tx,
    userId: counterpartyId,
    event: 'dispute_submitted_member',
    data: {
      transactionId: input.transactionId,
      listingTitle: transaction.listingTitle,
      reason: DISPUTE_REASON_LABELS[input.reason],
    },
    linkUrl: `/deals/${input.transactionId}`,
    idempotencyKey: `dispute_submitted:${created.id}`,
  });

  return created;
}
