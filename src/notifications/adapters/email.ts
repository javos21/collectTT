/**
 * Email adapter.
 *
 *   EMAIL_ADAPTER=console  -> prints to the terminal. No account, no network, no cost.
 *                             This is what makes local auth work offline: the magic
 *                             link shows up in your dev server output.
 *   EMAIL_ADAPTER=resend   -> real delivery, set when deploying at the end of Phase 0.
 *
 * The console implementation is not a stub to throw away — it is the same seam the
 * WhatsApp adapter will occupy, so exercising it locally proves the seam works.
 */

import { Resend } from 'resend';

import { env } from '../../lib/env';
import { db } from '../../db/client';
import { profiles } from '../../db/schema/profiles';
import { users } from '../../db/schema/auth';
import { eq } from 'drizzle-orm';
import type { DeliveryRequest, NotificationAdapter } from '../dispatch';

let resend: Resend | null = null;

function resendClient(): Resend {
  if (resend !== null) return resend;
  const key = env().RESEND_API_KEY;
  if (key === undefined || key === '') throw new Error('RESEND_API_KEY is not set');
  resend = new Resend(key);
  return resend;
}

export interface RawEmail {
  to: string;
  subject: string;
  text: string;
}

/** Low-level send, used by Better Auth for magic links as well as by the adapter. */
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

  const result = await resendClient().emails.send({
    from: e.EMAIL_FROM,
    to: email.to,
    subject: email.subject,
    text: email.text,
  });

  if (result.error !== null && result.error !== undefined) {
    throw new Error(`Resend error: ${result.error.message}`);
  }
  return { providerMessageId: result.data?.id };
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
