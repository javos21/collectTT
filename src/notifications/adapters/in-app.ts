/**
 * In-app adapter.
 *
 * The inbox row is written synchronously by `notify()` inside the caller's transaction,
 * so by the time a dispatch job could run there is nothing left to deliver. This
 * adapter exists so the channel is a first-class registered member of the set rather
 * than a special case branching through the dispatcher.
 */

import type { DeliveryRequest, NotificationAdapter } from '../dispatch';

export const inAppAdapter: NotificationAdapter = {
  channel: 'in_app',

  isAvailable() {
    return true;
  },

  async send(_request: DeliveryRequest) {
    // Already persisted by notify(). Nothing to do.
    return {};
  },
};
