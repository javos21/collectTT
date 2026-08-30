/**
 * Better Auth, self-hosted with identity data in our own Postgres.
 *
 * Verified email/password is the account-creation and sign-in path. Authentication
 * identity remains separate from the domain profile that owns listings and reputation.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP } from 'better-auth/plugins';

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
  },
  plugins: [
    emailOTP({
      overrideDefaultEmailVerification: true,
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      sendVerificationOTP: async ({ email, otp }) => {
        await sendEmail({
          to: email,
          subject: 'Your CollectTT verification code',
          text: [
            `Your CollectTT verification code is: ${otp}`,
            '',
            'Enter this code on the sign-up screen to verify your email address.',
            'This code expires in 10 minutes. If you did not create an account, you can ignore this email.',
          ].join('\n'),
        });
      },
    }),
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
});

export type Session = typeof auth.$Infer.Session;
