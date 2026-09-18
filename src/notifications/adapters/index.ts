/**
 * Adapter registration. Both the web process and the worker process call
 * `registerAdapters()` at startup.
 */

import { registerAdapter } from '../dispatch';
import { inAppAdapter } from './in-app';
import { emailAdapter } from './email';

let registered = false;

export function registerAdapters(): void {
  if (registered) return;

  registerAdapter(inAppAdapter);
  registerAdapter(emailAdapter);

  registered = true;
}

export { inAppAdapter, emailAdapter };
