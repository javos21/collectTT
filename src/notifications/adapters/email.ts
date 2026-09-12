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
  /** Optional CTA rendered as a styled button in the HTML version. */
  actionUrl?: string;
  actionLabel?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function absoluteUrl(value: string, baseUrl: string): string {
  const url = new URL(value, baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Email action URL must use http or https');
  }
  return url.toString();
}

function bodyHtml(text: string, actionUrl?: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split('\n')
        .filter((line) => actionUrl === undefined || line.trim() !== actionUrl)
        .map(escapeHtml)
        .join('<br />'),
    )
    .filter((paragraph) => paragraph !== '');

  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 18px;color:#3730a3;font-size:16px;line-height:1.65;">${paragraph}</p>`,
    )
    .join('');
}

function actionHtml(actionUrl: string | undefined, actionLabel: string | undefined): string {
  if (actionUrl === undefined || actionLabel === undefined) return '';

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px;">',
    '<tr>',
    '<td bgcolor="#4f46e5" style="border-radius:10px;">',
    `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 22px;border:1px solid #4f46e5;border-radius:10px;color:#ffffff;font-family:'Inter Variable',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:700;line-height:1;text-decoration:none;">${escapeHtml(actionLabel)}</a>`,
    '</td>',
    '</tr>',
    '</table>',
  ].join('');
}

/** Render the shared CollectTT HTML email shell, including its plain-text-derived body. */
export function renderEmailHtml(email: RawEmail): string {
  const e = env();
  const logoUrl = absoluteUrl('/assets/collecttt_logo.png', e.APP_URL);
  const actionUrl = email.actionUrl === undefined ? undefined : absoluteUrl(email.actionUrl, e.APP_URL);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(email.subject)}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background:#f6f7ff;color:#3730a3;font-family:\'Inter Variable\',Inter,-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f7ff;">',
    '<tr>',
    '<td align="center" style="padding:36px 16px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe3ff;border-radius:18px;">',
    '<tr>',
    '<td align="center" style="padding:32px 32px 22px;">',
    `<img src="${escapeHtml(logoUrl)}" width="180" alt="CollectTT" style="display:block;width:180px;max-width:100%;height:auto;margin:0 auto;border:0;">`,
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:0 32px 26px;">',
    `<h1 style="margin:0 0 20px;color:#1e1b4b;font-family:'Inter Variable',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:24px;font-weight:750;line-height:1.25;">${escapeHtml(email.subject)}</h1>`,
    bodyHtml(email.text, actionUrl),
    actionHtml(actionUrl, email.actionLabel),
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="padding:18px 32px 28px;border-top:1px solid #eef0ff;color:#818cf8;font-family:\'Inter Variable\',Inter,-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;font-size:12px;line-height:1.5;text-align:center;">Collect with confidence across Trinidad &amp; Tobago.</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
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
    htmlContent: renderEmailHtml(email),
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

    const e = env();
    const actionUrl =
      request.message.linkUrl === undefined
        ? undefined
        : absoluteUrl(request.message.linkUrl, e.APP_URL);
    const lines = [request.message.body];
    if (actionUrl !== undefined) {
      lines.push('', actionUrl);
    }

    return sendEmail({
      to,
      subject: request.message.title,
      text: lines.join('\n'),
      ...(actionUrl !== undefined ? { actionUrl, actionLabel: 'Go To Deal' } : {}),
    });
  },
};
