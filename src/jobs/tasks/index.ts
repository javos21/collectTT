/**
 * The task registry and its payload types.
 *
 * ★ EVERY handler must be idempotent. The first statement of a handler is always a
 *   conditional UPDATE (or a guard read) that no-ops when the state has already moved,
 *   because Graphile Worker guarantees at-least-once, not exactly-once, delivery.
 *
 * Phase 0 ships `image:process` and `notifications:dispatch`. The Phase 1 and 2 tasks
 * are declared here so the payload contracts are agreed before the handlers exist —
 * and so `enqueue()` is type-checked against them from the start.
 */

import type { Task, TaskList } from 'graphile-worker';

import { processImage } from './process-image';
import { dispatchNotification } from './dispatch-notification';
import { auctionClose } from './auction-close';
import {
  paymentWindowExpired,
  dropoffWindowExpired,
  paymentReminder,
  promoteNext,
  reputationRecompute,
  consistencyCheck,
  receiptWindowExpired,
  fallbackOfferExpired,
} from './transaction-windows';
import { custodyOverstay } from './custody-overstay';
import { rateLimitCleanup } from './rate-limit-cleanup';
import { listingExpiry } from './listing-expiry';

/** Payload contract for every task in the system. */
export interface TaskPayloads {
  // ---- Phase 0
  'image:process': { imageId: string };
  'notifications:dispatch': { deliveryId: string };

  // ---- Phase 1
  'auction:close': { listingId: string };
  'auction:fallback_expire': { offerId: string };
  'listing:expire': { listingId: string };
  'transaction:payment_window': { transactionId: string };
  'transaction:dropoff_window': { transactionId: string };
  'transaction:promote_next': { listingId: string; failedTransactionId: string };
  'transaction:payment_reminder': { transactionId: string; reminderKind?: 'halfway' | 'two_hours' | 'deadline' };
  'transaction:receipt_window': { transactionId: string };
  'reputation:recompute': Record<string, never>;
  'consistency:check': Record<string, never>;

  // ---- Phase 2 (declared now, implemented with custody)
  'custody:overstay': { holdingId: string };
  'security:rate_limit_cleanup': Record<string, never>;
}

export type TaskName = keyof TaskPayloads;

/**
 * Handlers registered with the worker. A task declared above but absent here simply
 * cannot be enqueued yet — `enqueue()` type-checks the name, and the worker would log
 * an unknown-task error, which is the loud failure we want during phased build-out.
 */
export const taskList: TaskList = {
  // Phase 0
  'image:process': processImage as Task,
  'notifications:dispatch': dispatchNotification as Task,
  // Phase 1
  'auction:close': auctionClose as Task,
  'auction:fallback_expire': fallbackOfferExpired as Task,
  'listing:expire': listingExpiry as Task,
  'transaction:payment_window': paymentWindowExpired as Task,
  'transaction:dropoff_window': dropoffWindowExpired as Task,
  'transaction:payment_reminder': paymentReminder as Task,
  'transaction:receipt_window': receiptWindowExpired as Task,
  'transaction:promote_next': promoteNext as Task,
  'reputation:recompute': reputationRecompute as Task,
  'consistency:check': consistencyCheck as Task,
  // Phase 2
  'custody:overstay': custodyOverstay as Task,
  'security:rate_limit_cleanup': rateLimitCleanup as Task,
};

export const IMPLEMENTED_TASKS = Object.keys(taskList);
