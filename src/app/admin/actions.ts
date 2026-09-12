'use server';

import { redirect } from 'next/navigation';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db/client';
import { notificationDeliveries } from '@/db/schema/notifications';
import { profiles, restrictions } from '@/db/schema/profiles';
import { enqueue } from '@/jobs/enqueue';
import { requireAdmin } from '@/lib/admin';
import { recordAdminAudit } from '@/services/admin-audit';
import { RESTRICTION_TYPES, type RestrictionType } from '@/domain/policy/reputation';
import {
  removeMarketplaceOption,
  saveMarketplaceOption,
  setFullServiceDeliveryDays,
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
  const viewer = await requireAdmin('/admin/settings');

  const days = Number(formData.get('fullServiceDeliveryDays') ?? NaN);
  if (!Number.isInteger(days) || days < 1 || days > 60) redirect('/admin/settings?settingsError=days');

  await setFullServiceDeliveryDays(days, viewer.userId);
  redirect('/admin/settings?settings=Delivery+setting+saved.');
}

export async function saveMarketplaceOptionAction(formData: FormData): Promise<void> {
  const viewer = await requireAdmin();
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
  const viewer = await requireAdmin();
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
  const viewer = await requireAdmin(callback);
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

export async function suspendMemberAction(formData: FormData): Promise<void> {
  const memberId = text(formData, 'memberId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdmin(memberCallback(memberId));
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
  const viewer = await requireAdmin(memberCallback(memberId));
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
  const viewer = await requireAdmin(memberCallback(memberId));
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
        .values({ userId: memberId, type, source: 'admin', reason, expiresAt })
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

export async function liftMemberRestrictionAction(formData: FormData): Promise<void> {
  const memberId = text(formData, 'memberId');
  const restrictionId = text(formData, 'restrictionId');
  const reason = text(formData, 'reason');
  const viewer = await requireAdmin(memberCallback(memberId));
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
        .set({ liftedAt: sql`now()` })
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
