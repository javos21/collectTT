import { sql } from 'drizzle-orm';

import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

/** Lightweight unauthenticated readiness check for Render and uptime monitors. */
export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    const failedRows = await db.execute(sql`
      select count(*)::int as count
      from notification_deliveries
      where status = 'failed'
    `);
    const failed = Number((failedRows.rows[0] as { count?: number | string } | undefined)?.count ?? 0);
    return Response.json({
      ok: true,
      database: 'ready',
      failedNotificationDeliveries: failed,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({
      ok: false,
      database: 'unavailable',
      error: error instanceof Error ? error.message : 'Database readiness check failed.',
      checkedAt: new Date().toISOString(),
    }, { status: 503 });
  }
}
