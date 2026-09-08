import { and, count, desc, eq, or } from 'drizzle-orm';

import type { DbOrTx } from '@/db/client';
import { custodyHoldings, relayStores } from '@/db/schema/custody';
import { listings } from '@/db/schema/listings';
import { transactions } from '@/db/schema/transactions';
import { usesCustodyTrack, type FulfillmentPath } from '@/domain/states/transaction';
import type { CustodyState } from '@/domain/states/custody';
import type { PaymentState } from '@/domain/states/payment';

type DealAttentionState = Pick<typeof transactions.$inferSelect, 'state' | 'buyerId' | 'sellerId' | 'paymentState'>;

/** Whether this deal is currently waiting for an action from the signed-in user. */
export function dealNeedsAttentionForUser(deal: DealAttentionState, userId: string): boolean {
  const isBuyer = deal.buyerId === userId;
  if (!isBuyer && deal.sellerId !== userId) return false;

  return deal.state === 'open' && (
    (isBuyer && deal.paymentState === 'pending') ||
    (!isBuyer && deal.paymentState === 'buyer_marked_paid')
  );
}

/** Count open deals for which the signed-in user currently has the next move. */
export async function countDealsNeedingAttention(executor: DbOrTx, userId: string): Promise<number> {
  const result = await executor
    .select({ value: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.state, 'open'),
        or(
          and(eq(transactions.buyerId, userId), eq(transactions.paymentState, 'pending')),
          and(eq(transactions.sellerId, userId), eq(transactions.paymentState, 'buyer_marked_paid')),
        ),
      ),
    );

  return Number(result[0]?.value ?? 0);
}

export type ActiveDealRole = 'buying' | 'selling';
export type PhysicalDealTask = 'to_drop_off' | 'to_collect' | 'at_store' | null;

/**
 * The intentionally small, server-produced representation used by every active-deal
 * projection. Dates are serialized here so this object can be passed to a client
 * disclosure list without teaching the client anything about database rows.
 *
 * `dropoffCode` is deliberately not part of this model. Codes are private counter
 * credentials and remain available only on the authorized canonical deal page.
 */
export interface ActiveDealSummary {
  id: string;
  listingId: string;
  title: string;
  role: ActiveDealRole;
  /** Whether this viewer currently has the next payment action. */
  needsAttention: boolean;
  amountCents: number;
  fulfillmentPath: FulfillmentPath;
  paymentState: PaymentState;
  paymentStatus: string;
  deliveryStatus: string;
  currentState: string;
  nextStep: string;
  deadlineAt: string;
  physicalTask: PhysicalDealTask;
  location: { name: string; area: string | null } | null;
  /** Whether the canonical deal page can show this viewer a valid counter code. */
  canShowCode: boolean;
}

const PAYMENT_STATUS_LABELS: Record<PaymentState, string> = {
  pending: 'Awaiting payment',
  buyer_marked_paid: 'Payment marked',
  confirmed: 'Payment confirmed',
  failed: 'Payment failed',
};

const DELIVERY_STATUS_LABELS: Record<CustodyState, string> = {
  not_applicable: 'Peer hand-off',
  awaiting_dropoff: 'Awaiting drop-off',
  at_relay: 'At store',
  release_authorized: 'Ready for pickup',
  picked_up: 'Collected',
  returned_to_seller: 'Returned to seller',
  voided: 'Drop-off cancelled',
};

type ActiveDealInput = Pick<
  typeof transactions.$inferSelect,
  | 'id'
  | 'listingId'
  | 'state'
  | 'buyerId'
  | 'sellerId'
  | 'amountCents'
  | 'fulfillmentPath'
  | 'paymentState'
  | 'paymentDeadlineAt'
  | 'sellerDropoffDeadlineAt'
  | 'custodyState'
> & {
  title: string;
  custodyExpiresAt: Date | null;
  storeName: string | null;
  storeArea: string | null;
};

/**
 * Turn one transaction/custody join row into the shared active-deal view model.
 * Keeping this pure makes the most important wording and task projection easy to
 * exercise without a database and prevents My Deals and Collect / Drop-Off drifting.
 */
export function summarizeActiveDeal(deal: ActiveDealInput, userId: string): ActiveDealSummary {
  const isBuyer = deal.buyerId === userId;
  const role: ActiveDealRole = isBuyer ? 'buying' : 'selling';
  const hasCustody = usesCustodyTrack(deal.fulfillmentPath);
  const custodyState = deal.custodyState as CustodyState;
  const paymentState = deal.paymentState as PaymentState;

  let currentState = 'In progress';
  let nextStep = 'View full deal';
  let deadline = deal.paymentDeadlineAt;

  if (paymentState === 'pending') {
    currentState = 'Offer accepted';
    nextStep = isBuyer ? 'Pay the seller' : 'Waiting for buyer payment';
  } else if (paymentState === 'buyer_marked_paid') {
    currentState = 'Payment marked';
    nextStep = isBuyer ? 'Waiting for seller confirmation' : 'Confirm payment';
  } else if (paymentState === 'confirmed') {
    currentState = 'Payment confirmed';
    if (custodyState === 'awaiting_dropoff') {
      nextStep = isBuyer ? 'Waiting for seller drop-off' : 'Drop off item';
      deadline = deal.sellerDropoffDeadlineAt ?? deal.paymentDeadlineAt;
    } else if (custodyState === 'at_relay') {
      currentState = 'At pickup store';
      nextStep = isBuyer ? 'Waiting for store release' : 'Waiting for buyer pickup';
      deadline = deal.custodyExpiresAt ?? deal.paymentDeadlineAt;
    } else if (custodyState === 'release_authorized') {
      currentState = 'Ready for pickup';
      nextStep = isBuyer ? 'Collect item' : 'Waiting for buyer pickup';
      deadline = deal.custodyExpiresAt ?? deal.paymentDeadlineAt;
    } else if (!hasCustody) {
      currentState = 'Payment confirmed';
      nextStep = 'Complete the hand-off';
    }
  }

  const physicalTask: PhysicalDealTask = !hasCustody
    ? null
    : custodyState === 'awaiting_dropoff' && !isBuyer
      ? 'to_drop_off'
      : custodyState === 'release_authorized' && isBuyer
        ? 'to_collect'
        : custodyState === 'at_relay'
          ? 'at_store'
          : null;

  const canShowCode =
    (custodyState === 'awaiting_dropoff' && !isBuyer) ||
    ((custodyState === 'at_relay' || custodyState === 'release_authorized') && isBuyer);

  return {
    id: deal.id,
    listingId: deal.listingId,
    title: deal.title,
    role,
    needsAttention: dealNeedsAttentionForUser(deal, userId),
    amountCents: deal.amountCents,
    fulfillmentPath: deal.fulfillmentPath,
    paymentState,
    paymentStatus: PAYMENT_STATUS_LABELS[paymentState],
    deliveryStatus: DELIVERY_STATUS_LABELS[custodyState],
    currentState,
    nextStep,
    deadlineAt: deadline.toISOString(),
    physicalTask,
    location: deal.storeName === null ? null : { name: deal.storeName, area: deal.storeArea },
    canShowCode,
  };
}

/** Fetch every open deal visible to this member, with one consistent summary shape. */
export async function activeDealsForUser(
  executor: DbOrTx,
  userId: string,
): Promise<ActiveDealSummary[]> {
  const rows = await executor
    .select({
      transaction: transactions,
      title: listings.title,
      custodyExpiresAt: custodyHoldings.custodyExpiresAt,
      storeName: relayStores.name,
      storeArea: relayStores.area,
    })
    .from(transactions)
    .innerJoin(listings, eq(listings.id, transactions.listingId))
    .leftJoin(custodyHoldings, eq(custodyHoldings.currentTransactionId, transactions.id))
    .leftJoin(relayStores, eq(relayStores.id, custodyHoldings.storeId))
    .where(
      and(
        eq(transactions.state, 'open'),
        or(eq(transactions.buyerId, userId), eq(transactions.sellerId, userId)),
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(50);

  return rows.map(({ transaction, title, custodyExpiresAt, storeName, storeArea }) =>
    summarizeActiveDeal(
      {
        ...transaction,
        title,
        custodyExpiresAt,
        storeName,
        storeArea,
      },
      userId,
    ),
  );
}
