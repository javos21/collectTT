/**
 * The shelf clock ran out.
 *
 * Flags the holding for internal custody bookkeeping. It does NOT record a reputation
 * event: reputation stays about deal-breaking, and a paid-but-uncollected item has
 * already settled on the money track.
 *
 * ★ IDEMPOTENT, and the guard is load-bearing rather than defensive: the clock can
 *   EXTEND under a job that is already queued, because confirming payment pushes the
 *   deadline out. A job scheduled against the tight unpaid clock will routinely fire
 *   on an item that is no longer overstayed.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Helpers } from 'graphile-worker';

import { db } from '../../db/client';
import { custodyHoldings } from '../../db/schema/custody';

interface Payload {
  holdingId: string;
}

export async function custodyOverstay(payload: Payload, helpers: Helpers): Promise<void> {
  await db.transaction(async (tx) => {
    // ★ One conditional UPDATE decides everything: still live, genuinely expired, and
    //   not already flagged. Zero rows back means there is nothing to do. The expiry
    //   comparison resolves on the DATABASE clock — never Date.now() in this process,
    //   which would make the outcome depend on which machine ran the job.
    const flagged = await tx
      .update(custodyHoldings)
      .set({ overstayFlaggedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(custodyHoldings.id, payload.holdingId),
          sql`${custodyHoldings.state} in ('at_relay', 'release_authorized')`,
          sql`${custodyHoldings.custodyExpiresAt} is not null`,
          sql`${custodyHoldings.custodyExpiresAt} < now()`,
          isNull(custodyHoldings.overstayFlaggedAt),
        ),
      )
      .returning({ id: custodyHoldings.id });

    if (flagged.length === 0) {
      helpers.logger.info(`holding ${payload.holdingId} is not overstayed — nothing to do`);
      return;
    }

    helpers.logger.info(`holding ${payload.holdingId} flagged as overstayed`);
  });
}
