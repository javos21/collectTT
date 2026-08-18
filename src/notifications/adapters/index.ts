/**
 * Adapter registration. Both the web process and the worker process call
 * `registerAdapters()` at startup.
 *
 * ── Adding WhatsApp later ────────────────────────────────────────────────────
 *   1. write src/notifications/adapters/whatsapp.ts exporting a NotificationAdapter
 *   2. add one line below
 * That is the entire change. The 'whatsapp' channel value already exists in the
 * database enum and the event catalogue already routes the high-value events to it.
 * Nothing at any call site knows or cares.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { registerAdapter } from '../dispatch';
import { inAppAdapter } from './in-app';
import { emailAdapter } from './email';

let registered = false;

export function registerAdapters(): void {
  if (registered) return;

  registerAdapter(inAppAdapter);
  registerAdapter(emailAdapter);
  // registerAdapter(whatsappAdapter);  <- later, once Meta verification clears

  registered = true;
}

export { inAppAdapter, emailAdapter };
