/**
 * Better Auth, self-hosted, data in our own Postgres.
 *
 * Phase 0 ships EMAIL MAGIC LINK only — no Meta dependency, no gatekeeper, so
 * onboarding cannot be blocked by a verification queue. Phone verification and
 * WhatsApp OTP slot in later; the durable decision is "self-hosted, own-your-data",
 * not this particular library.
 *
 * In development the magic link is printed to the terminal by the console email
 * adapter, which means local auth needs no vendor account at all.
 */

import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '../db/client';
import * as schema from '../db/schema/index';
import { env } from './env';
import { sendEmail } from '../notifications/adapters/email';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  secret: env().BETTER_AUTH_SECRET,
  baseURL: env().BETTER_AUTH_URL,
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days — this is a community, not a bank
    updateAge: 60 * 60 * 24,
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: 'Your CollectTT sign-in link',
          text: [
            'Tap the link below to sign in to CollectTT.',
            '',
            url,
            '',
            'This link expires in 15 minutes. If you did not request it, ignore this email.',
          ].join('\n'),
        });
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
