/** Authorized projections for private identity data. */

import { eq } from 'drizzle-orm';

import { db, type DbOrTx } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { transactions } from '@/db/schema/transactions';
import { recordAdminAudit } from '@/services/admin-audit';

export class PrivateDisclosureNotFoundError extends Error {}

export interface CounterpartyContact {
  displayName: string;
  phoneE164: string;
}

/** Return only the other party's private phone for a committed transaction. */
export async function counterpartyContact(
  executor: DbOrTx,
  viewerUserId: string,
  transactionId: string,
): Promise<CounterpartyContact> {
  const rows = await executor
    .select({
      buyerId: transactions.buyerId,
      sellerId: transactions.sellerId,
    })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .limit(1);
  const transaction = rows[0];
  if (transaction === undefined) throw new PrivateDisclosureNotFoundError();

  const counterpartyId = viewerUserId === transaction.buyerId
    ? transaction.sellerId
    : viewerUserId === transaction.sellerId
      ? transaction.buyerId
      : null;
  if (counterpartyId === null) throw new PrivateDisclosureNotFoundError();

  const contacts = await executor
    .select({
      displayName: profiles.displayName,
      phoneE164: profiles.phoneE164,
    })
    .from(profiles)
    .where(eq(profiles.userId, counterpartyId))
    .limit(1);
  const contact = contacts[0];
  if (contact?.phoneE164 === null || contact?.phoneE164 === undefined) {
    throw new PrivateDisclosureNotFoundError();
  }
  return { ...contact, phoneE164: contact.phoneE164 };
}

/** Read one member's private phone for support and append an audit event atomically. */
export async function auditedAdminPhoneAccess(adminUserId: string, memberUserId: string) {
  return db.transaction(async (tx) => {
    const admin = await tx
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.userId, adminUserId))
      .limit(1);
    if (admin[0]?.role !== 'admin') throw new PrivateDisclosureNotFoundError();

    const rows = await tx
      .select({ phoneE164: profiles.phoneE164 })
      .from(profiles)
      .where(eq(profiles.userId, memberUserId))
      .limit(1);
    if (rows[0] === undefined) throw new PrivateDisclosureNotFoundError();

    await recordAdminAudit(tx, {
      actorUserId: adminUserId,
      targetType: 'member_phone',
      targetId: memberUserId,
      action: 'view_private_phone',
      reason: 'Viewed member phone in the support console.',
      requestMetadata: { source: 'admin_member_detail' },
    });
    return rows[0];
  });
}
