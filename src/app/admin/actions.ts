'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { db, dbNow, type Tx } from '@/db/client';
import { disputes, notificationDeliveries } from '@/db/schema/notifications';
import { supportCases } from '@/db/schema/support-cases';
import { listings, claims, bids, listingAuditEvents } from '@/db/schema/listings';
import { profiles, reputationEvents, restrictions } from '@/db/schema/profiles';
import { transactions, transactionEvents } from '@/db/schema/transactions';
import { onTransactionTerminated } from '@/services/custody';
import { extendPaymentDeadline, invalidateAuctionBid, rescheduleTransactionDeadlineJobs, terminateTransaction } from '@/services/transactions';
import { enqueue } from '@/jobs/enqueue';
import { requireAdminAction } from '@/lib/admin';
import { notify } from '@/notifications/dispatch';
import { recordAdminAudit } from '@/services/admin-audit';
import { recordEvent } from '@/services/reputation';
import { isSupportCaseStatus, updateSupportCase } from '@/services/support-cases';
import { RESTRICTION_TYPES, type RestrictionType } from '@/domain/policy/reputation';
import {
  removeMarketplaceOption,
  saveMarketplaceOption,
  setFullServiceDeliveryDays,
  getListingExpiryDays,
  setListingExpiryDays,
  getRestrictionPolicy,
  setRestrictionPolicySetting,
  RESTRICTION_LOOKBACK_DAYS_KEY,
  RESTRICTION_DURATION_HOURS_KEY,
  BUYER_PREPAY_REQUIRED_AT_KEY,
  BUYER_BID_BLOCKED_AT_KEY,
  BUYER_RESERVE_BLOCKED_AT_KEY,
  SELLER_PUBLISH_BLOCKED_AT_KEY,
  type MarketplaceOptionKind,
} from '@/services/platform-settings';

function text(formData: FormData, field: string): string {
  return String(formData.get(field) ?? '').trim();
}

function safeKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function memberCallback(memberId: string): string {
  return `/admin/members/${encodeURIComponent(memberId)}`;
}

function validRestrictionType(value: string): value is RestrictionType {
  return (RESTRICTION_TYPES as readonly string[]).includes(value);
}

function actionError(memberId: string, message: string): never {
  redirect(`${memberCallback(memberId)}?adminError=${encodeURIComponent(message)}`);
}

function actionSuccess(memberId: string, message: string): never {
  redirect(`${memberCallback(memberId)}?adminSuccess=${encodeURIComponent(message)}`);
}

function validReason(reason: string): boolean {
  return reason.length >= 10 && reason.length <= 500;
}

export async function invalidateAuctionBidAction(formData: FormData): Promise<void> {
  const viewer = await requireAdminAction();
  const bidId = text(formData, 'bidId');
  const listingId = text(formData, 'listingId');
  const reason = text(formData, 'reason');
  if (!isUuid(bidId) || !isUuid(listingId) || !validReason(reason)) {
    redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=${encodeURIComponent('A bid ID, listing ID, and a reason of 10–500 characters are required.')}`);
  }
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select({ listingId: bids.listingId }).from(bids).where(eq(bids.id, bidId)).limit(1);
      if (rows[0]?.listingId !== listingId) throw new Error('Bid does not belong to this listing.');
      await invalidateAuctionBid(tx, { bidId, adminUserId: viewer.userId, reason });
    });
  } catch (error) {
    redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=${encodeURIComponent(error instanceof Error ? error.message : 'Bid invalidation failed.')}`);
  }
  revalidatePath(`/admin/listings/${listingId}`);
  redirect(`/admin/listings/${listingId}?adminSuccess=${encodeURIComponent('Bid invalidated and the auction ladder recomputed.')}`);
}

function parseExpiry(value: string): Date | null {
  if (value === '') return null;
  const expiry = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now() ? null : expiry;
}

async function recordRejectedMemberAction(input: {
  tx: Tx;
  actorUserId: string;
  memberId: string;
  action: string;
  reason: string;
  beforeContext: Record<string, unknown>;
  message: string;
}) {
  await recordAdminAudit(input.tx, {
    actorUserId: input.actorUserId,
    targetType: 'member',
    targetId: input.memberId,
    action: input.action,
    reason: input.reason,
    outcome: 'rejected',
    beforeContext: input.beforeContext,
    afterContext: input.beforeContext,
    requestMetadata: { source: 'admin_ui' },
  });
  return { ok: false as const, message: input.message };
}

export async function updateDeliveryDefaultsAction(formData: FormData): Promise<void> {
  const viewer = await requireAdminAction('/admin/settings');

  const days = Number(formData.get('fullServiceDeliveryDays') ?? NaN);
  if (!Number.isInteger(days) || days < 1 || days > 60) redirect('/admin/settings?settingsError=days');

  await setFullServiceDeliveryDays(days, viewer.userId);
  redirect('/admin/settings?settings=Delivery+setting+saved.');
}

export async function updateListingExpiryAction(formData: FormData): Promise<void> {
  const viewer = await requireAdminAction('/admin/settings');
  const days = Number(formData.get('listingExpiryDays') ?? NaN);
  if (!Number.isInteger(days) || days < 1 || days > 365) redirect('/admin/settings?settingsError=expiry');
  await setListingExpiryDays(days, viewer.userId);
  redirect('/admin/settings?settings=Listing+expiry+setting+saved.');
}

export async function updateRestrictionPolicyAction(formData: FormData): Promise<void> {
  const viewer = await requireAdminAction('/admin/settings');
  const values: Array<[string, number]> = [
    [RESTRICTION_LOOKBACK_DAYS_KEY, Number(formData.get('lookbackDays') ?? NaN)],
    [RESTRICTION_DURATION_HOURS_KEY, Number(formData.get('durationHours') ?? NaN)],
    [BUYER_PREPAY_REQUIRED_AT_KEY, Number(formData.get('buyerPrepayAt') ?? NaN)],
    [BUYER_BID_BLOCKED_AT_KEY, Number(formData.get('buyerBidAt') ?? NaN)],
    [BUYER_RESERVE_BLOCKED_AT_KEY, Number(formData.get('buyerReserveAt') ?? NaN)],
    [SELLER_PUBLISH_BLOCKED_AT_KEY, Number(formData.get('sellerPublishAt') ?? NaN)],
  ];
  if (values.some(([, value]) => !Number.isInteger(value))) redirect('/admin/settings?settingsError=Enter+whole+numbers+for+restriction+policy.');
  try {
    await db.transaction(async (tx) => {
      const before = await getRestrictionPolicy(tx);
      for (const [key, value] of values) await setRestrictionPolicySetting(key, value, viewer.userId, tx);
      const after = await getRestrictionPolicy(tx);
      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'platform_settings',
        targetId: 'restriction_policy',
        action: 'update_restriction_policy',
        reason: 'Updated progressive restriction thresholds and lifecycle settings.',
        beforeContext: { ...before },
        afterContext: { ...after },
        requestMetadata: { source: 'admin_ui' },
      });
    });
  } catch (error) {
    redirect(`/admin/settings?settingsError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not save restriction policy.')}`);
  }
  redirect('/admin/settings?settings=Restriction+policy+saved.');
}

export async function saveMarketplaceOptionAction(formData: FormData): Promise<void> {
  const viewer = await requireAdminAction();
  const id = text(formData, 'id');
  const kind = text(formData, 'kind') as MarketplaceOptionKind;
  const label = text(formData, 'label');
  const description = text(formData, 'description');
  const key = safeKey(text(formData, 'key') || label);
  const sortOrder = Number(text(formData, 'sortOrder') || 0);
  const requiresStore = formData.get('requiresStore') !== null;

  if ((kind !== 'delivery' && kind !== 'payment') || label === '' || key === '' || !Number.isInteger(sortOrder)) {
    redirect('/admin/settings?settingsError=Add+a+name+and+a+valid+display+order.');
  }

  try {
    await saveMarketplaceOption({
      ...(id !== '' ? { id } : {}),
      kind,
      key,
      label,
      description: description || null,
      requiresStore,
      sortOrder,
    }, viewer.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save this option.';
    redirect(`/admin/settings?settingsError=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/settings?settings=${encodeURIComponent(`${label} saved.`)}`);
}

export async function removeMarketplaceOptionAction(formData: FormData): Promise<void> {
  const viewer = await requireAdminAction();
  const id = text(formData, 'id');
  const label = text(formData, 'label') || 'Option';
  if (id === '') redirect('/admin/settings?settingsError=Option+not+found.');
  try {
    await removeMarketplaceOption(id, viewer.userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not remove this option.';
    redirect(`/admin/settings?settingsError=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/settings?settings=${encodeURIComponent(`${label} removed.`)}`);
}

/**
 * Requeue one failed email delivery. The failed-status guard and unique retry job key
 * make a double-click or stale admin tab a rejected, audited no-op instead of a second
 * email send.
 */
export async function retryNotificationDeliveryAction(formData: FormData): Promise<void> {
  const deliveryId = text(formData, 'deliveryId');
  const callback = `/admin/notifications/${encodeURIComponent(deliveryId)}`;
  const viewer = await requireAdminAction(callback);
  const reason = text(formData, 'reason');

  if (!isUuid(deliveryId)) redirect(`${callback}?retryError=Delivery+not+found.`);
  if (reason.length < 10) {
    redirect(`${callback}?retryError=${encodeURIComponent('Enter a retry reason of at least 10 characters.')}`);
  }
  if (reason.length > 500) {
    redirect(`${callback}?retryError=Retry+reason+must+be+500+characters+or+fewer.`);
  }

  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: notificationDeliveries.id,
          channel: notificationDeliveries.channel,
          status: notificationDeliveries.status,
          eventType: notificationDeliveries.eventType,
          attempts: notificationDeliveries.attempts,
          lastError: notificationDeliveries.lastError,
          providerMessageId: notificationDeliveries.providerMessageId,
          sentAt: notificationDeliveries.sentAt,
        })
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.id, deliveryId))
        .limit(1);
      const delivery = rows[0];

      if (delivery === undefined) return { ok: false, message: 'Delivery not found.' };

      const beforeContext = {
        channel: delivery.channel,
        status: delivery.status,
        eventType: delivery.eventType,
        attempts: delivery.attempts,
        lastError: delivery.lastError,
        providerMessageId: delivery.providerMessageId,
        sentAt: delivery.sentAt?.toISOString() ?? null,
      };

      if (delivery.channel !== 'email') {
        await recordAdminAudit(tx, {
          actorUserId: viewer.userId,
          targetType: 'notification_delivery',
          targetId: deliveryId,
          action: 'retry_email_delivery',
          reason,
          outcome: 'rejected',
          beforeContext,
          afterContext: beforeContext,
          requestMetadata: { source: 'admin_ui' },
        });
        return { ok: false, message: 'Only email deliveries can be retried.' };
      }

      if (delivery.status !== 'failed') {
        await recordAdminAudit(tx, {
          actorUserId: viewer.userId,
          targetType: 'notification_delivery',
          targetId: deliveryId,
          action: 'retry_email_delivery',
          reason,
          outcome: 'rejected',
          beforeContext,
          afterContext: beforeContext,
          requestMetadata: { source: 'admin_ui' },
        });
        return { ok: false, message: 'Only failed email deliveries can be retried.' };
      }

      const updated = await tx
        .update(notificationDeliveries)
        .set({
          status: 'pending',
          lastError: null,
          providerMessageId: null,
          sentAt: null,
        })
        .where(and(
          eq(notificationDeliveries.id, deliveryId),
          eq(notificationDeliveries.channel, 'email'),
          eq(notificationDeliveries.status, 'failed'),
        ))
        .returning({ id: notificationDeliveries.id });

      if (updated.length === 0) {
        await recordAdminAudit(tx, {
          actorUserId: viewer.userId,
          targetType: 'notification_delivery',
          targetId: deliveryId,
          action: 'retry_email_delivery',
          reason,
          outcome: 'rejected',
          beforeContext,
          afterContext: beforeContext,
          requestMetadata: { source: 'admin_ui', conflict: true },
        });
        return { ok: false, message: 'This delivery changed before the retry could be queued.' };
      }

      const jobKey = `dispatch:retry:${deliveryId}:${delivery.attempts + 1}`;
      await enqueue(tx, 'notifications:dispatch', { deliveryId }, { jobKey });

      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'notification_delivery',
        targetId: deliveryId,
        action: 'retry_email_delivery',
        reason,
        outcome: 'succeeded',
        beforeContext,
        afterContext: {
          ...beforeContext,
          status: 'pending',
          lastError: null,
          providerMessageId: null,
          sentAt: null,
          queued: true,
        },
        requestMetadata: { source: 'admin_ui', jobKey },
      });

      return { ok: true };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not queue the email retry.';
    redirect(`${callback}?retryError=${encodeURIComponent(message)}`);
  }

  if (!result.ok) redirect(`${callback}?retryError=${encodeURIComponent(result.message)}`);
  redirect(`${callback}?retry=queued`);
}

/**
 * Resolve or dismiss one open member dispute. The dispute row, notifications, and
 * append-only admin audit record commit together, and a stale tab becomes a rejected
 * audited no-op instead of overwriting another administrator's decision.
 */
export async function reviewDisputeAction(formData: FormData): Promise<void> {
  const disputeId = text(formData, 'disputeId');
  const decision = text(formData, 'decision');
  const resolution = text(formData, 'resolution');
  const requestedNextState = text(formData, 'nextState') || 'open';
  const viewer = await requireAdminAction('/admin/deals');

  if (!isUuid(disputeId)) redirect('/admin/deals?adminError=Dispute+not+found.');
  if (decision !== 'resolved' && decision !== 'dismissed') {
    redirect('/admin/deals?adminError=Choose+whether+to+resolve+or+dismiss+the+dispute.');
  }
  if (!['open', 'completed', 'cancelled', 'expired'].includes(requestedNextState)) {
    redirect('/admin/deals?adminError=Choose+a+valid+deal+outcome.');
  }
  if (!validReason(resolution)) {
    redirect('/admin/deals?adminError=Enter+a+resolution+note+between+10+and+500+characters.');
  }

  let result: { ok: true; transactionId: string } | { ok: false; transactionId: string | null; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          dispute: disputes,
          transaction: transactions,
          listingTitle: listings.title,
        })
        .from(disputes)
        .innerJoin(transactions, eq(transactions.id, disputes.transactionId))
        .innerJoin(listings, eq(listings.id, transactions.listingId))
        .where(eq(disputes.id, disputeId))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return { ok: false, transactionId: null, message: 'Dispute not found.' };

      const beforeContext = {
        status: row.dispute.status,
        reason: row.dispute.reason,
        detail: row.dispute.detail,
        resolution: row.dispute.resolution,
        resolvedBy: row.dispute.resolvedBy,
        resolvedAt: row.dispute.resolvedAt?.toISOString() ?? null,
      };

      if (row.dispute.status !== 'open') {
        await recordAdminAudit(tx, {
          actorUserId: viewer.userId,
          targetType: 'dispute',
          targetId: disputeId,
          action: 'review_dispute',
          reason: resolution,
          outcome: 'rejected',
          beforeContext,
          afterContext: beforeContext,
          requestMetadata: { source: 'admin_ui', decision, conflict: true },
        });
        return { ok: false, transactionId: row.transaction.id, message: 'This dispute has already been reviewed.' };
      }

      const nextState = requestedNextState as 'open' | 'completed' | 'cancelled' | 'expired';
      if (nextState === 'completed' && !(row.transaction.paymentState === 'confirmed' && row.transaction.custodyState !== 'awaiting_dropoff' && row.transaction.handoffState !== 'awaiting_handoff' && row.transaction.handoffState !== 'seller_handed_over')) {
        return { ok: false, transactionId: row.transaction.id, message: 'This deal is not eligible for completion yet.' };
      }

      const updated = await tx
        .update(disputes)
        .set({
          status: decision,
          resolution,
          resolvedBy: viewer.userId,
          resolvedAt: sql`now()`,
        })
        .where(and(eq(disputes.id, disputeId), eq(disputes.status, 'open')))
        .returning({ id: disputes.id });

      if (updated.length === 0) {
        await recordAdminAudit(tx, {
          actorUserId: viewer.userId,
          targetType: 'dispute',
          targetId: disputeId,
          action: 'review_dispute',
          reason: resolution,
          outcome: 'rejected',
          beforeContext,
          afterContext: beforeContext,
          requestMetadata: { source: 'admin_ui', decision, conflict: true },
        });
        return { ok: false, transactionId: row.transaction.id, message: 'This dispute changed before it could be reviewed.' };
      }

      const remainingOpen = await tx.select({ id: disputes.id }).from(disputes).where(and(
        eq(disputes.transactionId, row.transaction.id),
        eq(disputes.status, 'open'),
      )).limit(1);
      if (row.transaction.disputeState === 'open' && remainingOpen.length === 0) {
        if (nextState !== 'open') {
          await onTransactionTerminated(tx, row.transaction.id, { candidatesRemain: false });
          if (row.transaction.claimId !== null) {
            await tx.update(claims).set({ status: 'reneged' }).where(eq(claims.id, row.transaction.claimId));
          }
        }
        await tx.update(transactions).set({
          state: nextState === 'open' ? 'open' : nextState,
          disputeState: nextState === 'open' ? 'resolved' : 'resolved',
          completedAt: nextState === 'completed' ? sql`now()` : null,
          terminatedAt: nextState === 'completed' ? null : sql`now()`,
          terminatedReason: nextState === 'completed' ? null : 'admin',
          updatedAt: sql`now()`,
        }).where(and(eq(transactions.id, row.transaction.id), eq(transactions.state, 'open'), eq(transactions.disputeState, 'open')));
        await tx.insert(transactionEvents).values({
          transactionId: row.transaction.id,
          track: 'overall',
          fromState: 'disputed',
          toState: nextState,
          actorUserId: viewer.userId,
          actorRole: 'admin',
          reason: resolution,
          metadata: { disputeId, decision },
        });
        if (nextState === 'completed') {
          await recordEvent({ tx, userId: row.transaction.buyerId, type: 'purchase_completed', transactionId: row.transaction.id, counterpartyUserId: row.transaction.sellerId });
          await recordEvent({ tx, userId: row.transaction.sellerId, type: 'sale_completed', transactionId: row.transaction.id, counterpartyUserId: row.transaction.buyerId });
          for (const userId of [row.transaction.buyerId, row.transaction.sellerId]) {
            await notify({ tx, userId, event: 'transaction_completed', data: { listingTitle: row.listingTitle }, linkUrl: `/deals/${row.transaction.id}`, idempotencyKey: `completed:${row.transaction.id}:${userId}` });
          }
        }
        if (nextState !== 'open') {
          await tx.update(listings).set({ status: nextState === 'completed' ? 'ended_won' : 'active', activeTransactionId: null, updatedAt: sql`now()` }).where(eq(listings.id, row.transaction.listingId));
        } else {
          await tx.update(listings).set({ activeTransactionId: row.transaction.id, updatedAt: sql`now()` }).where(eq(listings.id, row.transaction.listingId));
          await rescheduleTransactionDeadlineJobs(tx, row.transaction);
        }
      }

      // Keep the contextual support case created from this dispute in lock-step
      // with the adjudication, so the support queue cannot show a phantom open case.
      await tx.update(supportCases).set({
        status: decision,
        resolution,
        resolvedBy: viewer.userId,
        resolvedAt: sql`now()`,
        updatedAt: sql`now()`,
      }).where(and(
        eq(supportCases.targetType, 'transaction'),
        eq(supportCases.targetId, row.transaction.id),
        eq(supportCases.reporterUserId, row.dispute.raisedBy),
        inArray(supportCases.status, ['open', 'in_review']),
      ));

      const afterContext = {
        ...beforeContext,
        status: decision,
        resolution,
        resolvedBy: viewer.userId,
        resolvedAt: 'database_now',
        nextState,
      };
      const recipients = [...new Set([row.transaction.buyerId, row.transaction.sellerId])];
      for (const userId of recipients) {
        await notify({
          tx,
          userId,
          event: 'dispute_reviewed_member',
          data: {
            transactionId: row.transaction.id,
            listingTitle: row.listingTitle,
            status: decision,
            resolution,
          },
          linkUrl: `/deals/${row.transaction.id}`,
          idempotencyKey: `dispute_reviewed:${disputeId}:${decision}`,
        });
      }

      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'dispute',
        targetId: disputeId,
        action: 'review_dispute',
        reason: resolution,
        outcome: 'succeeded',
        beforeContext,
        afterContext,
        requestMetadata: { source: 'admin_ui', decision, nextState: requestedNextState },
      });

      return { ok: true, transactionId: row.transaction.id };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not review the dispute.';
    redirect(`/admin/deals?adminError=${encodeURIComponent(message)}`);
  }

  const callback = result.transactionId === null
    ? '/admin/deals'
    : `/admin/deals/${encodeURIComponent(result.transactionId)}`;
  if (!result.ok) redirect(`${callback}?adminError=${encodeURIComponent(result.message)}`);
  revalidatePath(callback);
  redirect(`${callback}?adminSuccess=${encodeURIComponent(`Dispute ${decision} recorded.`)}`);
}

export async function extendDealDeadlineAction(formData: FormData): Promise<void> {
  const transactionId = text(formData, 'transactionId');
  const reason = text(formData, 'reason');
  const hours = Number(text(formData, 'hours'));
  const callback = `/admin/deals/${encodeURIComponent(transactionId)}`;
  const viewer = await requireAdminAction(callback);
  if (!isUuid(transactionId)) redirect('/admin/deals?adminError=Deal+not+found.');
  if (!Number.isInteger(hours) || hours < 1 || hours > 168 || reason.length < 10 || reason.length > 500) {
    redirect(`${callback}?adminError=${encodeURIComponent('Choose 1–168 hours and provide a reason between 10 and 500 characters.')}`);
  }
  try {
    await db.transaction(async (tx) => {
      const before = await tx.select({ deadline: transactions.paymentDeadlineAt, state: transactions.state }).from(transactions).where(eq(transactions.id, transactionId)).limit(1);
      const prior = before[0];
      if (prior === undefined) throw new Error('Deal not found.');
      const deadline = await extendPaymentDeadline({ tx, transactionId, hours, reason, adminUserId: viewer.userId });
      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'transaction',
        targetId: transactionId,
        action: 'extend_payment_deadline',
        reason,
        outcome: 'succeeded',
        beforeContext: { state: prior.state, paymentDeadlineAt: prior.deadline.toISOString() },
        afterContext: { state: prior.state, paymentDeadlineAt: deadline.toISOString(), extendedHours: hours },
        requestMetadata: { source: 'admin_ui' },
      });
    });
  } catch (error) {
    redirect(`${callback}?adminError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not extend deadline.')}`);
  }
  revalidatePath(callback);
  redirect(`${callback}?adminSuccess=Payment+deadline+extended.`);
}

export async function cancelDealAction(formData: FormData): Promise<void> {
  const transactionId = text(formData, 'transactionId');
  const reason = text(formData, 'reason');
  const callback = `/admin/deals/${encodeURIComponent(transactionId)}`;
  const viewer = await requireAdminAction(callback);
  if (!isUuid(transactionId) || !validReason(reason)) redirect(`${callback}?adminError=Provide+a+cancellation+reason+between+10+and+500+characters.`);
  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const rows = await tx.select({ state: transactions.state, disputeState: transactions.disputeState, paymentState: transactions.paymentState, buyerId: transactions.buyerId, sellerId: transactions.sellerId, listingTitle: listings.title }).from(transactions).innerJoin(listings, eq(listings.id, transactions.listingId)).where(eq(transactions.id, transactionId)).limit(1);
      const current = rows[0];
      if (current === undefined) return { ok: false, message: 'Deal not found.' };
      const beforeContext = { state: current.state, disputeState: current.disputeState, paymentState: current.paymentState };
      if (current.state !== 'open' || current.disputeState === 'open') {
        await recordAdminAudit(tx, { actorUserId: viewer.userId, targetType: 'transaction', targetId: transactionId, action: 'cancel_transaction', reason, outcome: 'rejected', beforeContext, afterContext: beforeContext, requestMetadata: { source: 'admin_ui' } });
        return { ok: false, message: current.disputeState === 'open' ? 'Resolve the open dispute before cancelling this deal.' : 'Only open deals can be cancelled.' };
      }
      const changed = await terminateTransaction({ tx, transactionId, reason: 'admin', actorUserId: viewer.userId, actorRole: 'admin', promoteNext: false });
      if (!changed) return { ok: false, message: 'This deal changed before it could be cancelled.' };
      await tx.update(supportCases).set({
        status: 'dismissed',
        resolution: `Deal cancelled by support: ${reason}`,
        resolvedBy: viewer.userId,
        resolvedAt: sql`now()`,
        updatedAt: sql`now()`,
      }).where(and(
        eq(supportCases.targetType, 'transaction'),
        eq(supportCases.targetId, transactionId),
        inArray(supportCases.status, ['open', 'in_review']),
      ));
      for (const userId of [current.buyerId, current.sellerId]) {
        await notify({ tx, userId, event: 'transaction_admin_cancelled', data: { listingTitle: current.listingTitle, reason: `CollectTT support cancelled this deal. Reason: ${reason}` }, linkUrl: `/deals/${transactionId}`, idempotencyKey: `transaction-admin-cancelled:${transactionId}:${userId}` });
      }
      await recordAdminAudit(tx, { actorUserId: viewer.userId, targetType: 'transaction', targetId: transactionId, action: 'cancel_transaction', reason, outcome: 'succeeded', beforeContext, afterContext: { ...beforeContext, state: 'cancelled', terminatedReason: 'admin' }, requestMetadata: { source: 'admin_ui' } });
      return { ok: true };
    });
    if (!result.ok) redirect(`${callback}?adminError=${encodeURIComponent(result.message)}`);
  } catch (error) {
    redirect(`${callback}?adminError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not cancel deal.')}`);
  }
  revalidatePath(callback);
  redirect(`${callback}?adminSuccess=Deal+cancelled.`);
}

export async function suspendMemberAction(formData: FormData): Promise<void> {
  const memberId = text(formData, 'memberId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdminAction(memberCallback(memberId));
  if (!isUuid(memberId)) actionError(memberId, 'Member not found.');
  if (!validReason(reason)) actionError(memberId, 'Enter a suspension reason between 10 and 500 characters.');

  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ userId: profiles.userId, displayName: profiles.displayName, role: profiles.role, status: profiles.status })
        .from(profiles)
        .where(eq(profiles.userId, memberId))
        .limit(1);
      const member = rows[0];
      if (member === undefined) return { ok: false, message: 'Member not found.' };

      const beforeContext = { status: member.status, role: member.role, displayName: member.displayName };
      if (member.userId === viewer.userId) {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'suspend_member', reason, beforeContext, message: 'You cannot suspend your own administrator account.' });
      }
      if (member.role === 'admin') {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'suspend_member', reason, beforeContext, message: 'Administrator accounts require a separate access-review process.' });
      }
      if (member.status !== 'active' && member.status !== 'restricted') {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'suspend_member', reason, beforeContext, message: `Member is already ${member.status}.` });
      }

      const updated = await tx
        .update(profiles)
        .set({ status: 'suspended', updatedAt: sql`now()` })
        .where(and(
          eq(profiles.userId, memberId),
          or(eq(profiles.status, 'active'), eq(profiles.status, 'restricted')),
        ))
        .returning({ userId: profiles.userId });
      if (updated.length === 0) {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'suspend_member', reason, beforeContext, message: 'This member changed before suspension could be applied.' });
      }

      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'member',
        targetId: memberId,
        action: 'suspend_member',
        reason,
        beforeContext,
        afterContext: { ...beforeContext, status: 'suspended' },
        requestMetadata: { source: 'admin_ui' },
      });
      return { ok: true };
    });
  } catch (error) {
    actionError(memberId, error instanceof Error ? error.message : 'Could not suspend this member.');
  }
  if (!result.ok) actionError(memberId, result.message);
  actionSuccess(memberId, 'Member suspended.');
}

export async function reactivateMemberAction(formData: FormData): Promise<void> {
  const memberId = text(formData, 'memberId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdminAction(memberCallback(memberId));
  if (!isUuid(memberId)) actionError(memberId, 'Member not found.');
  if (!validReason(reason)) actionError(memberId, 'Enter a reactivation reason between 10 and 500 characters.');

  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ userId: profiles.userId, displayName: profiles.displayName, role: profiles.role, status: profiles.status })
        .from(profiles)
        .where(eq(profiles.userId, memberId))
        .limit(1);
      const member = rows[0];
      if (member === undefined) return { ok: false, message: 'Member not found.' };

      const beforeContext = { status: member.status, role: member.role, displayName: member.displayName };
      if (member.status !== 'suspended') {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'reactivate_member', reason, beforeContext, message: 'Only suspended members can be reactivated by this action.' });
      }

      const updated = await tx
        .update(profiles)
        .set({ status: 'active', updatedAt: sql`now()` })
        .where(and(eq(profiles.userId, memberId), eq(profiles.status, 'suspended')))
        .returning({ userId: profiles.userId });
      if (updated.length === 0) {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'reactivate_member', reason, beforeContext, message: 'This member changed before reactivation could be applied.' });
      }

      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'member',
        targetId: memberId,
        action: 'reactivate_member',
        reason,
        beforeContext,
        afterContext: { ...beforeContext, status: 'active' },
        requestMetadata: { source: 'admin_ui' },
      });
      return { ok: true };
    });
  } catch (error) {
    actionError(memberId, error instanceof Error ? error.message : 'Could not reactivate this member.');
  }
  if (!result.ok) actionError(memberId, result.message);
  actionSuccess(memberId, 'Member reactivated.');
}

export async function addMemberRestrictionAction(formData: FormData): Promise<void> {
  const memberId = text(formData, 'memberId');
  const typeValue = text(formData, 'type');
  const reason = text(formData, 'reason');
  const expiresAtText = text(formData, 'expiresAt');
  const viewer = await requireAdminAction(memberCallback(memberId));
  if (!isUuid(memberId)) actionError(memberId, 'Member not found.');
  if (!validRestrictionType(typeValue)) actionError(memberId, 'Choose a valid restriction type.');
  if (!validReason(reason)) actionError(memberId, 'Enter a restriction reason between 10 and 500 characters.');
  const expiresAt = parseExpiry(expiresAtText);
  if (expiresAtText !== '' && expiresAt === null) actionError(memberId, 'Choose a future expiry date.');
  const type = typeValue as RestrictionType;

  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const memberRows = await tx
        .select({ displayName: profiles.displayName, status: profiles.status })
        .from(profiles)
        .where(eq(profiles.userId, memberId))
        .limit(1);
      const member = memberRows[0];
      if (member === undefined) return { ok: false, message: 'Member not found.' };

      const duplicateRows = await tx
        .select({ id: restrictions.id, reason: restrictions.reason, expiresAt: restrictions.expiresAt })
        .from(restrictions)
        .where(and(
          eq(restrictions.userId, memberId),
          eq(restrictions.type, type),
          eq(restrictions.source, 'admin'),
          isNull(restrictions.liftedAt),
          or(isNull(restrictions.expiresAt), gt(restrictions.expiresAt, sql`now()`)),
        ))
        .limit(1);
      const duplicate = duplicateRows[0];
      const beforeContext = { status: member.status, restriction: duplicate ?? null };
      if (duplicate !== undefined) {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'add_member_restriction', reason, beforeContext, message: `An active ${type.replaceAll('_', ' ')} restriction already exists.` });
      }

      const inserted = await tx
        .insert(restrictions)
        .values({ userId: memberId, type, source: 'admin', sourceActorUserId: viewer.userId, lifecycleStatus: 'active', reason, expiresAt })
        .returning({ id: restrictions.id, type: restrictions.type, source: restrictions.source, expiresAt: restrictions.expiresAt });
      const restriction = inserted[0];
      if (restriction === undefined) throw new Error('Could not create the restriction.');

      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'member',
        targetId: memberId,
        action: 'add_member_restriction',
        reason,
        beforeContext,
        afterContext: { status: member.status, restriction: { ...restriction, expiresAt: restriction.expiresAt?.toISOString() ?? null } },
        requestMetadata: { source: 'admin_ui' },
      });
      return { ok: true };
    });
  } catch (error) {
    actionError(memberId, error instanceof Error ? error.message : 'Could not add this restriction.');
  }
  if (!result.ok) actionError(memberId, result.message);
  actionSuccess(memberId, 'Restriction added.');
}

/** Append a private, auditable trust correction. It never changes public counters. */
export async function addTrustAdjustmentAction(formData: FormData): Promise<void> {
  const memberId = text(formData, 'memberId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdminAction(memberCallback(memberId));
  if (!isUuid(memberId)) actionError(memberId, 'Member not found.');
  if (!validReason(reason)) actionError(memberId, 'Enter a trust correction note between 10 and 500 characters.');
  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const member = await tx.select({ displayName: profiles.displayName }).from(profiles).where(eq(profiles.userId, memberId)).limit(1);
      if (member[0] === undefined) return { ok: false, message: 'Member not found.' };
      const metadata = { source: 'admin_ui', correction: reason };
      const duplicate = await tx.select({ id: reputationEvents.id }).from(reputationEvents).where(and(
        eq(reputationEvents.userId, memberId),
        eq(reputationEvents.type, 'admin_adjustment'),
        sql`${reputationEvents.transactionId} is null`,
        sql`${reputationEvents.metadata} @> ${JSON.stringify(metadata)}::jsonb`,
      )).limit(1);
      if (duplicate[0] !== undefined) {
        await recordAdminAudit(tx, {
          actorUserId: viewer.userId,
          targetType: 'member',
          targetId: memberId,
          action: 'add_trust_adjustment',
          reason,
          outcome: 'rejected',
          beforeContext: { duplicateEventId: duplicate[0].id },
          afterContext: { duplicateEventId: duplicate[0].id },
          requestMetadata: { source: 'admin_ui', idempotent: true },
        });
        return { ok: false, message: 'This trust correction was already recorded.' };
      }
      await recordEvent({ tx, userId: memberId, type: 'admin_adjustment', metadata });
      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'member',
        targetId: memberId,
        action: 'add_trust_adjustment',
        reason,
        outcome: 'succeeded',
        beforeContext: { member: member[0].displayName },
        afterContext: { member: member[0].displayName, adjustment: metadata },
        requestMetadata: { source: 'admin_ui' },
      });
      return { ok: true };
    });
  } catch (error) {
    actionError(memberId, error instanceof Error ? error.message : 'Could not record this trust correction.');
  }
  if (!result.ok) actionError(memberId, result.message);
  actionSuccess(memberId, 'Trust correction recorded privately.');
}

export async function liftMemberRestrictionAction(formData: FormData): Promise<void> {
  const memberId = text(formData, 'memberId');
  const restrictionId = text(formData, 'restrictionId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdminAction(memberCallback(memberId));
  if (!isUuid(memberId) || !isUuid(restrictionId)) actionError(memberId, 'Restriction not found.');
  if (!validReason(reason)) actionError(memberId, 'Enter a lift reason between 10 and 500 characters.');

  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: restrictions.id, userId: restrictions.userId, type: restrictions.type, source: restrictions.source, reason: restrictions.reason, expiresAt: restrictions.expiresAt, liftedAt: restrictions.liftedAt })
        .from(restrictions)
        .where(and(eq(restrictions.id, restrictionId), eq(restrictions.userId, memberId)))
        .limit(1);
      const restriction = rows[0];
      if (restriction === undefined) return { ok: false, message: 'Restriction not found for this member.' };

      const beforeContext = {
        type: restriction.type,
        source: restriction.source,
        reason: restriction.reason,
        expiresAt: restriction.expiresAt?.toISOString() ?? null,
        liftedAt: restriction.liftedAt?.toISOString() ?? null,
      };
      if (restriction.source !== 'admin') {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'lift_member_restriction', reason, beforeContext, message: 'Automatic restrictions are derived from reputation and cannot be manually lifted.' });
      }
      if (restriction.liftedAt !== null) {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'lift_member_restriction', reason, beforeContext, message: 'This restriction has already been lifted.' });
      }

      const updated = await tx
        .update(restrictions)
        .set({ liftedAt: sql`now()`, lifecycleStatus: 'lifted' })
        .where(and(
          eq(restrictions.id, restrictionId),
          eq(restrictions.userId, memberId),
          eq(restrictions.source, 'admin'),
          isNull(restrictions.liftedAt),
        ))
        .returning({ id: restrictions.id, liftedAt: restrictions.liftedAt });
      const lifted = updated[0];
      if (lifted === undefined) {
        return recordRejectedMemberAction({ tx, actorUserId: viewer.userId, memberId, action: 'lift_member_restriction', reason, beforeContext, message: 'This restriction changed before it could be lifted.' });
      }

      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'member_restriction',
        targetId: restrictionId,
        action: 'lift_member_restriction',
        reason,
        beforeContext,
        afterContext: { ...beforeContext, liftedAt: lifted.liftedAt?.toISOString() ?? null },
        requestMetadata: { source: 'admin_ui', memberId },
      });
      return { ok: true };
    });
  } catch (error) {
    actionError(memberId, error instanceof Error ? error.message : 'Could not lift this restriction.');
  }
  if (!result.ok) actionError(memberId, result.message);
  actionSuccess(memberId, 'Restriction lifted.');
}

/** Update a contextual support case with optimistic status and an append-only audit. */
export async function updateSupportCaseAction(formData: FormData): Promise<void> {
  const caseId = text(formData, 'caseId');
  const status = text(formData, 'status');
  const expectedStatus = text(formData, 'expectedStatus');
  const resolution = text(formData, 'resolution');
  const viewer = await requireAdminAction('/admin/support');
  if (!isUuid(caseId) || !isSupportCaseStatus(status) || !isSupportCaseStatus(expectedStatus)) {
    redirect('/admin/support?adminError=Choose+a+valid+support+case+state.');
  }
  if ((status === 'resolved' || status === 'dismissed') && !validReason(resolution)) {
    redirect('/admin/support?adminError=Closing+a+case+requires+a+resolution+note+between+10+and+500+characters.');
  }

  let result: { ok: true } | { ok: false; message: string };
  try {
    result = await db.transaction(async (tx) => {
      const rows = await tx.select().from(supportCases).where(eq(supportCases.id, caseId)).limit(1);
      const current = rows[0];
      if (current === undefined) return { ok: false, message: 'Support case not found.' };
      const beforeContext = {
        status: current.status,
        category: current.category,
        targetType: current.targetType,
        targetId: current.targetId,
        assignedTo: current.assignedTo,
        resolution: current.resolution,
      };
      if (current.status !== expectedStatus || current.status === 'resolved' || current.status === 'dismissed') {
        await recordAdminAudit(tx, {
          actorUserId: viewer.userId,
          targetType: 'support_case',
          targetId: caseId,
          action: 'update_support_case',
          reason: resolution || 'stale support case update',
          outcome: 'rejected',
          beforeContext,
          afterContext: beforeContext,
          requestMetadata: { source: 'admin_ui', expectedStatus, requestedStatus: status },
        });
        return { ok: false, message: 'This support case has already changed.' };
      }

      await updateSupportCase({
        tx,
        caseId,
        actorUserId: viewer.userId,
        status,
        expectedStatus,
        resolution: resolution || null,
        assignedTo: viewer.userId,
      });
      const afterContext = { ...beforeContext, status, assignedTo: viewer.userId, resolution: resolution || current.resolution };
      await recordAdminAudit(tx, {
        actorUserId: viewer.userId,
        targetType: 'support_case',
        targetId: caseId,
        action: 'update_support_case',
        reason: resolution || `Moved support case to ${status}.`,
        outcome: 'succeeded',
        beforeContext,
        afterContext,
        requestMetadata: { source: 'admin_ui', expectedStatus },
      });
      if (status === 'resolved' || status === 'dismissed') {
        const link = current.targetType === 'transaction'
          ? `/deals/${current.targetId}`
          : current.targetType === 'account'
            ? `/members/${current.targetId}`
            : `/listings/${current.targetId}`;
        await notify({
          tx,
          userId: current.reporterUserId,
          event: 'support_case_updated',
          data: { status, resolution: resolution || 'CollectTT support reviewed your report.' },
          linkUrl: link,
          idempotencyKey: `support-case:${caseId}:${status}`,
        });
      }
      return { ok: true };
    });
  } catch (error) {
    redirect(`/admin/support?adminError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not update support case.')}`);
  }
  if (!result.ok) redirect(`/admin/support?adminError=${encodeURIComponent(result.message)}`);
  revalidatePath('/admin/support');
  redirect(`/admin/support?adminSuccess=${encodeURIComponent(`Support case ${status}.`)}`);
}

async function moderateListing(listingId: string, operation: 'remove' | 'reactivate', reason: string, actorUserId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: listings.id, title: listings.title, sellerId: listings.sellerId, status: listings.status, saleType: listings.saleType, activeTransactionId: listings.activeTransactionId, expiresAt: listings.expiresAt }).from(listings).where(eq(listings.id, listingId)).limit(1);
    const listing = rows[0];
    if (listing === undefined) return { ok: false, message: 'Listing not found.' };
    const beforeContext = { status: listing.status, saleType: listing.saleType, activeTransactionId: listing.activeTransactionId, expiresAt: listing.expiresAt?.toISOString() ?? null };
    if (operation === 'remove') {
      if (listing.status !== 'active' && listing.status !== 'draft') return { ok: false, message: 'Only draft or active listings can be removed.' };
      if (listing.activeTransactionId !== null) return { ok: false, message: 'This listing has an active transaction and cannot be removed.' };
      const updated = await tx.update(listings).set({ status: 'cancelled', resolvedAt: sql`now()`, updatedAt: sql`now()` }).where(and(eq(listings.id, listingId), inArray(listings.status, ['active', 'draft']), isNull(listings.activeTransactionId))).returning({ id: listings.id });
      if (updated.length === 0) return { ok: false, message: 'The listing changed before it could be removed.' };
      await tx.insert(listingAuditEvents).values({ listingId, actorUserId, eventType: 'admin_removed', metadata: { fromStatus: listing.status, toStatus: 'cancelled', reason } });
      await recordAdminAudit(tx, { actorUserId, targetType: 'listing', targetId: listingId, action: 'remove_listing', reason, beforeContext, afterContext: { ...beforeContext, status: 'cancelled' }, requestMetadata: { source: 'admin_ui' } });
      await notify({ tx, userId: listing.sellerId, event: 'listing_moderation_updated', data: { listingTitle: listing.title, reason: `Support removed this listing from the marketplace. Reason: ${reason}` }, linkUrl: `/listings/${listingId}`, idempotencyKey: `listing-moderation:${listingId}:removed` });
      return { ok: true };
    }

    if (listing.saleType !== 'straight_sale' || (listing.status !== 'expired' && listing.status !== 'ended_no_sale')) return { ok: false, message: 'Only expired or ended fixed-price listings are eligible for reactivation.' };
    const now = await dbNow(tx);
    const expiryDays = await getListingExpiryDays(tx);
    const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
    const updated = await tx.update(listings).set({ status: 'active', publishedAt: sql`now()`, resolvedAt: null, expiresAt, updatedAt: sql`now()` }).where(and(eq(listings.id, listingId), inArray(listings.status, ['expired', 'ended_no_sale']), isNull(listings.activeTransactionId))).returning({ id: listings.id });
    if (updated.length === 0) return { ok: false, message: 'The listing changed before it could be reactivated.' };
    await tx.insert(listingAuditEvents).values({ listingId, actorUserId, eventType: 'admin_reactivated', metadata: { fromStatus: listing.status, toStatus: 'active', expiresAt: expiresAt.toISOString(), reason } });
    await recordAdminAudit(tx, { actorUserId, targetType: 'listing', targetId: listingId, action: 'reactivate_listing', reason, beforeContext, afterContext: { ...beforeContext, status: 'active', expiresAt: expiresAt.toISOString() }, requestMetadata: { source: 'admin_ui' } });
    await notify({ tx, userId: listing.sellerId, event: 'listing_moderation_updated', data: { listingTitle: listing.title, reason: `Support reactivated this listing until ${expiresAt.toLocaleDateString('en-TT')}. Reason: ${reason}` }, linkUrl: `/listings/${listingId}`, idempotencyKey: `listing-moderation:${listingId}:reactivated:${expiresAt.toISOString()}` });
    return { ok: true };
  });
}

export async function removeListingAction(formData: FormData): Promise<void> {
  const listingId = text(formData, 'listingId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdminAction(`/admin/listings/${listingId}`);
  if (!isUuid(listingId) || !validReason(reason)) redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=Provide+a+reason+between+10+and+500+characters.`);
  try {
    const result = await moderateListing(listingId, 'remove', reason, viewer.userId);
    if (!result.ok) redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=${encodeURIComponent(result.message)}`);
  } catch (error) {
    redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not remove listing.')}`);
  }
  revalidatePath(`/admin/listings/${listingId}`);
  redirect(`/admin/listings/${listingId}?adminSuccess=Listing+removed.`);
}

export async function reactivateListingAction(formData: FormData): Promise<void> {
  const listingId = text(formData, 'listingId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdminAction(`/admin/listings/${listingId}`);
  if (!isUuid(listingId) || !validReason(reason)) redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=Provide+a+reason+between+10+and+500+characters.`);
  try {
    const result = await moderateListing(listingId, 'reactivate', reason, viewer.userId);
    if (!result.ok) redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=${encodeURIComponent(result.message)}`);
  } catch (error) {
    redirect(`/admin/listings/${encodeURIComponent(listingId)}?adminError=${encodeURIComponent(error instanceof Error ? error.message : 'Could not reactivate listing.')}`);
  }
  revalidatePath(`/admin/listings/${listingId}`);
  redirect(`/admin/listings/${listingId}?adminSuccess=Listing+reactivated.`);
}
