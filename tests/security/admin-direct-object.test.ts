import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const contracts: Record<string, Record<string, string[]>> = {
  'src/app/admin/actions.ts': {
    retryNotificationDeliveryAction: ['eq(notificationDeliveries.id, deliveryId)'],
    reviewDisputeAction: [
      'eq(disputes.id, disputeId)',
      "eq(disputes.status, 'open')",
      'rescheduleTransactionDeadlineJobs(tx, row.transaction)',
    ],
    suspendMemberAction: ['eq(profiles.userId, memberId)'],
    reactivateMemberAction: ['eq(profiles.userId, memberId)'],
    addMemberRestrictionAction: ['eq(profiles.userId, memberId)', 'eq(restrictions.userId, memberId)'],
    liftMemberRestrictionAction: [
      'eq(restrictions.id, restrictionId)',
      'eq(restrictions.userId, memberId)',
    ],
  },
  'src/app/admin/catalog/actions.ts': {
    saveCategoryAction: ['eq(categories.key, originalKey)'],
    removeCategoryAction: ['eq(categories.key, key)'],
    saveCatalogValueAction: ['eq(catalogValues.id, id)', 'eq(catalogValues.kind, kind)'],
    removeCatalogValueAction: ['eq(catalogValues.id, id)'],
  },
  'src/app/admin/stores/actions.ts': {
    confirmStoreApplicationAction: ['confirmStoreApplication(id, viewer.userId)'],
    declineStoreApplicationAction: ['declineStoreApplication(id, viewer.userId'],
    deleteStoreAction: ['deleteRelayStore(id, viewer.userId)'],
  },
};

function actionBody(source: string, actionName: string): string {
  const match = source.match(new RegExp(
    `export async function ${actionName}\\([^]*?(?=\\nexport async function|\\s*$)`,
  ));
  if (match?.[0] === undefined) throw new Error(`Could not find ${actionName}`);
  return match[0];
}

describe('admin direct-object contracts', () => {
  it('keeps each target mutation bound to the submitted object and its relationship', () => {
    for (const [relativePath, actionContracts] of Object.entries(contracts)) {
      const source = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
      for (const [actionName, requiredExpressions] of Object.entries(actionContracts)) {
        const body = actionBody(source, actionName);
        for (const expression of requiredExpressions) {
          expect(body, `${relativePath}:${actionName}`).toContain(expression);
        }
      }
    }
  });
});
