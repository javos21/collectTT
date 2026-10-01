import { describe, expect, it } from 'vitest';

import { evaluateMarketplaceAction } from '../../src/services/marketplace-eligibility';

function executorReturning(...results: unknown[][]) {
  let selection = 0;

  return {
    select() {
      const result = results[selection++] ?? [];
      const chain = {
        from() { return chain; },
        leftJoin() { return chain; },
        where() { return chain; },
        limit() { return Promise.resolve(result); },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

describe('marketplace commitment eligibility', () => {
  it.each(['bid', 'create_commitment'] as const)(
    'allows a buyer with an active deal to %s',
    async (action) => {
      const executor = executorReturning(
        [{ status: 'active', phoneE164: '+18685551234' }],
        [],
        [{ id: 'existing-deal' }],
      );

      await expect(
        evaluateMarketplaceAction(executor as never, 'buyer', action),
      ).resolves.toEqual({ eligible: true });
    },
  );
});
