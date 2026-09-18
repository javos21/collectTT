import type { JobHelpers } from 'graphile-worker';

import { pruneExpiredRateLimitBuckets } from '../../lib/rate-limit';

export async function rateLimitCleanup(_payload: Record<string, never>, helpers: JobHelpers): Promise<void> {
  await pruneExpiredRateLimitBuckets();
  helpers.logger.info('expired rate-limit buckets pruned');
}
