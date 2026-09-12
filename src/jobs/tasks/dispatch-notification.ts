/**
 * notifications:dispatch — hand one delivery row to its channel adapter.
 *
 * One job per (event × channel), so a failing email cannot hold up a WhatsApp message
 * and a retry re-sends only the channel that actually failed.
 *
 * IDEMPOTENT: guarded on `status = 'pending'`. A replayed job finds the row already
 * 'sent' and returns without sending twice.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { JobHelpers } from 'graphile-worker';

import { db } from '../../db/client';
import { notificationDeliveries } from '../../db/schema/notifications';
import { getAdapter, type NotificationChannel, type RenderedMessage } from '../../notifications/dispatch';
import { registerAdapters } from '../../notifications/adapters/index';
import { EVENTS } from '../../notifications/events';

interface Payload {
  deliveryId: string;
}

export async function dispatchNotification(payload: Payload, helpers: JobHelpers): Promise<void> {
  registerAdapters();

  const { deliveryId } = payload;

  const rows = await db
    .select()
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.id, deliveryId), eq(notificationDeliveries.status, 'pending')))
    .limit(1);

  const delivery = rows[0];
  if (delivery === undefined) {
    helpers.logger.info(`delivery ${deliveryId} is not pending — already handled`);
    return;
  }

  // A delivery keeps its rendered payload, so a job queued before an event was
  // removed from the catalogue must not resurrect that retired notification.
  if (!Object.prototype.hasOwnProperty.call(EVENTS, delivery.eventType)) {
    await db
      .update(notificationDeliveries)
      .set({ status: 'skipped', lastError: 'event type no longer supported' })
      .where(eq(notificationDeliveries.id, deliveryId));
    helpers.logger.info(`delivery ${deliveryId} skipped — event ${delivery.eventType} is retired`);
    return;
  }

  const adapter = getAdapter(delivery.channel as NotificationChannel);
  if (adapter === undefined || !adapter.isAvailable()) {
    // The channel is routed in the event catalogue but has no adapter yet — WhatsApp,
    // today. Recorded as skipped so the gap is visible in the data rather than silent.
    await db
      .update(notificationDeliveries)
      .set({ status: 'skipped', lastError: 'no adapter registered for channel' })
      .where(eq(notificationDeliveries.id, deliveryId));
    helpers.logger.info(`delivery ${deliveryId} skipped — no ${delivery.channel} adapter`);
    return;
  }

  const payloadObj = delivery.payload as { message: RenderedMessage; data: Record<string, unknown> };

  try {
    const result = await adapter.send({
      deliveryId: delivery.id,
      userId: delivery.userId,
      eventType: delivery.eventType,
      message: payloadObj.message,
      data: payloadObj.data,
    });

    await db
      .update(notificationDeliveries)
      .set({
        status: 'sent',
        sentAt: sql`now()`,
        providerMessageId: result.providerMessageId ?? null,
        attempts: sql`${notificationDeliveries.attempts} + 1`,
      })
      .where(eq(notificationDeliveries.id, deliveryId));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(notificationDeliveries)
      .set({
        // Keep automatic Graphile retries pending. Once the queue has exhausted its
        // attempts, make the delivery visible to the audited admin retry flow.
        status: helpers.job.attempts >= helpers.job.max_attempts ? 'failed' : 'pending',
        lastError: message,
        attempts: sql`${notificationDeliveries.attempts} + 1`,
      })
      .where(eq(notificationDeliveries.id, deliveryId));
    // Rethrow so Graphile Worker retries with its own backoff.
    throw error;
  }
}
