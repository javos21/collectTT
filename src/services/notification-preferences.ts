import { and, eq } from 'drizzle-orm';

import type { DbOrTx } from '@/db/client';
import { db } from '@/db/client';
import { notificationPreferences } from '@/db/schema/notifications';
import { isEssentialEvent, OPTIONAL_NOTIFICATION_PREFERENCES, type EventType } from '@/notifications/events';

export type OptionalNotificationPreference = (typeof OPTIONAL_NOTIFICATION_PREFERENCES)[number];

export async function notificationPreferencesFor(
  userId: string,
  executor: DbOrTx = db,
): Promise<Record<OptionalNotificationPreference['eventType'], boolean>> {
  const rows = await executor
    .select({ eventType: notificationPreferences.eventType, enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.channel, 'email'),
    ));

  const values = Object.fromEntries(
    OPTIONAL_NOTIFICATION_PREFERENCES.map(({ eventType }) => [eventType, true]),
  ) as Record<OptionalNotificationPreference['eventType'], boolean>;
  for (const row of rows) {
    if (row.eventType in values) {
      values[row.eventType as OptionalNotificationPreference['eventType']] = row.enabled;
    }
  }
  return values;
}

export async function saveNotificationPreferences(
  userId: string,
  preferences: ReadonlyArray<{ eventType: EventType; emailEnabled: boolean }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const preference of preferences) {
      if (isEssentialEvent(preference.eventType)) {
        throw new Error('Essential CollectTT notifications cannot be disabled.');
      }
      if (!OPTIONAL_NOTIFICATION_PREFERENCES.some((option) => option.eventType === preference.eventType)) {
        throw new Error('That notification preference is not available.');
      }
      await tx
        .insert(notificationPreferences)
        .values({
          userId,
          eventType: preference.eventType,
          channel: 'email',
          enabled: preference.emailEnabled,
        })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.eventType, notificationPreferences.channel],
          set: { enabled: preference.emailEnabled },
        });
    }
  });
}
