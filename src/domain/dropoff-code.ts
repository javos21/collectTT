/**
 * The short code a member shows at the counter.
 *
 * It is BOTH the drop-off key and the collection token. A clerk with an unknown code
 * has a system-backed reason to refuse an item, which is the operational half of
 * "if it's not in the log, it doesn't belong there".
 *
 * The alphabet omits I, L, O, 0 and 1 so a misread character cannot resolve to a
 * different valid code.
 */

import { randomInt } from 'node:crypto';

export const DROPOFF_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateDropoffCode(): string {
  let body = '';
  for (let i = 0; i < 4; i += 1) {
    body += DROPOFF_CODE_ALPHABET[randomInt(DROPOFF_CODE_ALPHABET.length)];
  }
  return `CT-${body}`;
}
