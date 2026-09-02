/**
 * Postgres enums, mirrored 1:1 from src/domain/states.
 *
 * The domain module is the authority — these arrays are spread from it so the two can
 * never drift. If a state is added to the domain, `drizzle-kit generate` produces the
 * ALTER TYPE for it automatically.
 *
 * NOTE: `category` is deliberately NOT an enum. It is a text FK to the `categories`
 * table, so adding a category is an INSERT rather than a migration.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

import {
  ACTOR_ROLES,
  CUSTODY_STATES,
  EVENT_TRACKS,
  FULFILLMENT_PATHS,
  LISTING_STATUSES,
  PAYMENT_STATES,
  SALE_TYPES,
  SIZE_CLASSES,
  TERMINATION_REASONS,
  TRANSACTION_SOURCES,
  TRANSACTION_STATES,
} from '../../domain/states/index';
import {
  REPUTATION_EVENT_TYPES,
  RESTRICTION_SOURCES,
  RESTRICTION_TYPES,
} from '../../domain/policy/reputation';

// drizzle's pgEnum wants a mutable non-empty tuple; the domain exports readonly arrays.
const tuple = <T extends string>(values: readonly T[]): [T, ...T[]] => [
  values[0] as T,
  ...(values.slice(1) as T[]),
];

// ---------------------------------------------------------------- state machine
export const paymentStateEnum = pgEnum('payment_state', tuple(PAYMENT_STATES));
export const custodyStateEnum = pgEnum('custody_state', tuple(CUSTODY_STATES));
export const transactionStateEnum = pgEnum('transaction_state', tuple(TRANSACTION_STATES));
export const listingStatusEnum = pgEnum('listing_status', tuple(LISTING_STATUSES));
export const saleTypeEnum = pgEnum('sale_type', tuple(SALE_TYPES));
export const fulfillmentPathEnum = pgEnum('fulfillment_path', tuple(FULFILLMENT_PATHS));
export const terminationReasonEnum = pgEnum('termination_reason', tuple(TERMINATION_REASONS));
export const transactionSourceEnum = pgEnum('transaction_source', tuple(TRANSACTION_SOURCES));
export const sizeClassEnum = pgEnum('size_class', tuple(SIZE_CLASSES));
export const actorRoleEnum = pgEnum('actor_role', tuple(ACTOR_ROLES));
export const eventTrackEnum = pgEnum('event_track', tuple(EVENT_TRACKS));

// ---------------------------------------------------------------- reputation
export const reputationEventTypeEnum = pgEnum(
  'reputation_event_type',
  tuple(REPUTATION_EVENT_TYPES),
);
export const restrictionTypeEnum = pgEnum('restriction_type', tuple(RESTRICTION_TYPES));
export const restrictionSourceEnum = pgEnum('restriction_source', tuple(RESTRICTION_SOURCES));

// ---------------------------------------------------------------- everything else
export const userRoleEnum = pgEnum('user_role', ['member', 'store_staff', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'restricted', 'suspended', 'banned']);
export const claimStatusEnum = pgEnum('claim_status', [
  'active',
  'queued',
  'promoted',
  'reneged',
  'withdrawn',
  'expired',
  'superseded',
]);
export const bidStatusEnum = pgEnum('bid_status', ['active', 'outbid', 'won', 'retracted', 'void']);
export const offerStatusEnum = pgEnum('offer_status', ['pending', 'accepted', 'rejected']);
export const imageStatusEnum = pgEnum('image_status', ['pending', 'processing', 'ready', 'failed']);
export const custodyHolderEnum = pgEnum('custody_holder', ['relay_store', 'platform_courier']);
export const storeStaffRoleEnum = pgEnum('store_staff_role', ['staff', 'manager']);
export const storeApplicationStatusEnum = pgEnum('store_application_status', [
  'pending',
  'confirmed',
  'declined',
]);
export const notificationChannelEnum = pgEnum('notification_channel', [
  'in_app',
  'email',
  'whatsapp', // adapter arrives later; the value exists now so the seam is real
  'sms',
]);
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'pending',
  'sent',
  'failed',
  'skipped',
]);
export const disputeReasonEnum = pgEnum('dispute_reason', [
  'payment_not_received',
  'item_not_received',
  'item_not_as_described',
  'no_show',
  'other',
]);
export const disputeStatusEnum = pgEnum('dispute_status', ['open', 'resolved', 'dismissed']);
