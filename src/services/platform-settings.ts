import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { platformSettings } from '@/db/schema/settings';

export const FULL_SERVICE_DELIVERY_DAYS_KEY = 'full_service_delivery_days';
export const DEFAULT_FULL_SERVICE_DELIVERY_DAYS = 14;

export async function getFullServiceDeliveryDays(): Promise<number> {
  const rows = await db
    .select({ days: platformSettings.integerValue })
    .from(platformSettings)
    .where(eq(platformSettings.key, FULL_SERVICE_DELIVERY_DAYS_KEY))
    .limit(1);
  return rows[0]?.days ?? DEFAULT_FULL_SERVICE_DELIVERY_DAYS;
}

export async function setFullServiceDeliveryDays(days: number, adminUserId: string): Promise<void> {
  await db
    .insert(platformSettings)
    .values({ key: FULL_SERVICE_DELIVERY_DAYS_KEY, integerValue: days, updatedBy: adminUserId })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: { integerValue: days, updatedBy: adminUserId, updatedAt: new Date() },
    });
}
