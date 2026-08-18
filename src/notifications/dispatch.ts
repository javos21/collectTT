/**
 * CHANNEL-AGNOSTIC NOTIFICATION DISPATCH.
 *
 * Call sites never name a channel. They say "this happened, tell this person", and the
 * dispatcher fans out to whichever adapters are registered and enabled for that member.
 * Adding WhatsApp later is: implement the adapter, register it here. Zero call-site
 * changes anywhere in the codebase — that is the seam the plan asked for.
 *
 * ★ `notify()` takes an open DB transaction and writes the delivery rows inside it, so
 *   a state change and the notifications about it commit or roll back together.
 */

import { randomUUID } from 'node:crypto';

import type { DbOrTx } from '../db/client';
import { notificationDeliveries, notifications } from '../db/schema/notifications';
import { enqueue } from '../jobs/enqueue';
import { EVENTS, type EventType } from './events';

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'whatsapp', 'sms'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface RenderedMessage {
  title: string;
  body: string;
  linkUrl?: string;
}

export interface DeliveryRequest {
  deliveryId: string;
  userId: string;
  eventType: string;
  message: RenderedMessage;
  data: Record<string, unknown>;
}

/** What every channel implementation must provide. */
export interface NotificationAdapter {
  channel: NotificationChannel;
  /** False when the channel is not configured — dispatch then marks deliveries skipped. */
  isAvailable(): boolean;
  send(request: DeliveryRequest): Promise<{ providerMessageId?: string }>;
}

const adapters = new Map<NotificationChannel, NotificationAdapter>();

export function registerAdapter(adapter: NotificationAdapter): void {
  adapters.set(adapter.channel, adapter);
}

export function getAdapter(channel: NotificationChannel): NotificationAdapter | undefined {
  return adapters.get(channel);
}

export function registeredChannels(): NotificationChannel[] {
  return [...adapters.keys()];
}

export interface NotifyInput {
  tx: DbOrTx;
  userId: string;
  event: EventType;
  data?: Record<string, unknown>;
  linkUrl?: string;
  /**
   * Stable per logical occurrence. Two calls with the same key produce ONE delivery per
   * channel, no matter how many times a job is retried. Defaults to a random UUID, which
   * is correct only for genuinely one-off sends — job handlers should always pass one.
   */
  idempotencyKey?: string;
}

/**
 * Queue a notification for delivery. Writes the in-app row plus one delivery row per
 * channel, then enqueues the dispatch job — all on the caller's transaction.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const def = EVENTS[input.event];
  const data = input.data ?? {};
  const eventId = randomUUID();
  const baseKey = input.idempotencyKey ?? eventId;

  const message: RenderedMessage = {
    title: def.title(data),
    body: def.body(data),
    ...(input.linkUrl !== undefined ? { linkUrl: input.linkUrl } : {}),
  };

  // The in-app inbox row is written directly — it IS the in-app channel's delivery.
  if (def.channels.includes('in_app')) {
    await input.tx
      .insert(notifications)
      .values({
        userId: input.userId,
        eventType: def.type,
        title: message.title,
        body: message.body,
        linkUrl: input.linkUrl ?? null,
        data,
      })
      .onConflictDoNothing();
  }

  const rows = def.channels
    // Channels with no registered adapter are recorded as skipped rather than silently
    // dropped, so "WhatsApp was not built yet" is visible in the data.
    .map((channel) => ({
      eventId,
      userId: input.userId,
      eventType: def.type,
      channel,
      status: (channel === 'in_app'
        ? 'sent'
        : adapters.has(channel)
          ? 'pending'
          : 'skipped') as 'sent' | 'pending' | 'skipped',
      payload: { message, data },
      dedupeKey: `${baseKey}:${input.userId}:${channel}`,
      ...(channel === 'in_app' ? { sentAt: new Date() } : {}),
    }));

  const inserted = await input.tx
    .insert(notificationDeliveries)
    .values(rows)
    // ★ The dedupe key makes a replayed job a no-op rather than a duplicate message.
    .onConflictDoNothing({ target: notificationDeliveries.dedupeKey })
    .returning({ id: notificationDeliveries.id, status: notificationDeliveries.status });

  for (const row of inserted) {
    if (row.status !== 'pending') continue;
    // ★ Enqueued on the SAME transaction as the state change that caused it.
    await enqueue(input.tx, 'notifications:dispatch', { deliveryId: row.id }, {
      jobKey: `dispatch:${row.id}`,
    });
  }
}
