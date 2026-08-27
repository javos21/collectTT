/**
 * Better Auth, self-hosted with identity data in our own Postgres.
 *
 * Google is the primary path; verified email/password is the fallback. A verified
 * same-email Google identity can join an existing account without changing the stable
 * user ID that owns CollectTT profiles, listings, reputation and deals.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '../db/client';
import * as schema from '../db/schema/index';
import { env } from './env';
import { sendEmail } from '../notifications/adapters/email';

const config = env();

export const auth = betterAuth({
  appName: 'CollectTT',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  secret: config.BETTER_AUTH_SECRET,
  baseURL: config.BETTER_AUTH_URL,
  trustedOrigins: [config.APP_URL],
  socialProviders: {
    google: {
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      prompt: 'select_account',
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Reset your CollectTT password',
        text: [
          'Use the link below to choose a new CollectTT password.',
          '',
          url,
          '',
          'This link expires in one hour. If you did not request it, you can ignore this email.',
        ].join('\n'),
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: 'Verify your CollectTT email',
        text: [
          'Verify your email address to finish creating your CollectTT account.',
          '',
          url,
          '',
          'This link expires in one hour. If you did not create an account, you can ignore this email.',
        ].join('\n'),
      });
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      allowDifferentEmails: false,
      requireLocalEmailVerified: true,
      updateUserInfoOnLink: false,
      allowUnlinkingAll: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
});

export type Session = typeof auth.$Infer.Session;
