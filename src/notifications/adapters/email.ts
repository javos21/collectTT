/**
 * Email adapter.
 *
 *   EMAIL_ADAPTER=console  -> prints to the terminal. No account, no network, no cost.
 *                             Verification codes and reset links stay testable offline.
 *   EMAIL_ADAPTER=brevo    -> real transactional delivery through Brevo. The same SDK
 *                             can power the separate SMS adapter when that ships.
 *
 * The console implementation is not a stub to throw away — it is the same seam the
 * WhatsApp adapter will occupy, so exercising it locally proves the seam works.
 */

import { BrevoClient } from '@getbrevo/brevo';

import { env } from '../../lib/env';
import { db } from '../../db/client';
import { profiles } from '../../db/schema/profiles';
import { users } from '../../db/schema/auth';
import { eq } from 'drizzle-orm';
import type { DeliveryRequest, NotificationAdapter } from '../dispatch';

let brevo: BrevoClient | null = null;

function brevoClient(): BrevoClient {
  if (brevo !== null) return brevo;
  const key = env().BREVO_API_KEY;
  if (key === undefined || key === '') throw new Error('BREVO_API_KEY is not set');
  brevo = new BrevoClient({ apiKey: key, timeoutInSeconds: 15, maxRetries: 2 });
  return brevo;
}

function sender(from: string): { email: string; name?: string } {
  const match = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  if (match === null) return { email: from.trim() };
  const name = match[1]?.trim();
  return {
    email: match[2]!.trim(),
    ...(name !== undefined && name !== '' ? { name } : {}),
  };
}

export interface RawEmail {
  to: string;
  subject: string;
  text: string;
}

/** Low-level send, shared by Better Auth and the notification adapter. */
export async function sendEmail(email: RawEmail): Promise<{ providerMessageId?: string }> {
  const e = env();

  if (e.EMAIL_ADAPTER === 'console') {
    console.log(
      [
        '',
        '┌─────────────────────────────────────────────────────────────',
        `│ EMAIL -> ${email.to}`,
        `│ ${email.subject}`,
        '├─────────────────────────────────────────────────────────────',
        ...email.text.split('\n').map((line) => `│ ${line}`),
        '└─────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return {};
  }

  const result = await brevoClient().transactionalEmails.sendTransacEmail({
    sender: sender(e.EMAIL_FROM),
    to: [{ email: email.to }],
    subject: email.subject,
    textContent: email.text,
  });

  return { providerMessageId: result.messageId };
}

async function emailAddressFor(userId: string): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

export const emailAdapter: NotificationAdapter = {
  channel: 'email',

  isAvailable() {
    return true; // console mode always works
  },

  async send(request: DeliveryRequest) {
    const to = await emailAddressFor(request.userId);
    if (to === null) {
      throw new Error(`No email address for user ${request.userId}`);
    }

    const lines = [request.message.body];
    if (request.message.linkUrl !== undefined) {
      lines.push('', request.message.linkUrl);
    }

    return sendEmail({
      to,
      subject: request.message.title,
      text: lines.join('\n'),
    });
  },
};
