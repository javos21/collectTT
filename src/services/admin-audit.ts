import type { DbOrTx } from '@/db/client';
import { adminAuditEvents } from '@/db/schema/admin-audit';

export type AdminAuditOutcome = 'succeeded' | 'failed' | 'rejected';

export interface RecordAdminAuditInput {
  actorUserId: string | null;
  targetType: string;
  targetId: string;
  action: string;
  reason: string;
  outcome?: AdminAuditOutcome;
  beforeContext?: Record<string, unknown>;
  afterContext?: Record<string, unknown>;
  requestMetadata?: Record<string, unknown>;
}

/**
 * Record one administrator attempt. There are intentionally no update/delete
 * helpers: audit history is append-only and belongs in the same transaction as
 * the mutation it describes.
 */
export async function recordAdminAudit(tx: DbOrTx, input: RecordAdminAuditInput): Promise<string> {
  const rows = await tx
    .insert(adminAuditEvents)
    .values({
      actorUserId: input.actorUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      reason: input.reason,
      outcome: input.outcome ?? 'succeeded',
      beforeContext: input.beforeContext ?? {},
      afterContext: input.afterContext ?? {},
      requestMetadata: input.requestMetadata ?? {},
    })
    .returning({ id: adminAuditEvents.id });
  const row = rows[0];
  if (row === undefined) throw new Error('Failed to record admin audit event');
  return row.id;
}
