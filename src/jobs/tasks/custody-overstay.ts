import type { Helpers } from 'graphile-worker';

interface Payload {
  holdingId: string;
}

export async function custodyOverstay(payload: Payload, helpers: Helpers): Promise<void> {
  helpers.logger.info(`custody deadline retired for ${payload.holdingId}`);
}
