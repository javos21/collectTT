import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import { auth } from '@/lib/auth';
import { currentUser } from '@/lib/session';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

async function sendLink(formData: FormData): Promise<void> {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  if (email === '') return;

  await auth.api.signInMagicLink({
    body: { email, callbackURL: '/me' },
    headers: await headers(),
  });

  redirect('/sign-in?sent=1');
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const user = await currentUser();
  if (user !== null) redirect('/me');

  const { sent } = await searchParams;
  const consoleMode = env().EMAIL_ADAPTER === 'console';

  return (
    <main>
      <h1>Sign in</h1>
      <p className="muted">
        Enter your email and we&apos;ll send a sign-in link. No password to forget.
      </p>

      {sent === '1' && (
        <p className="ok">
          Link sent.
          {consoleMode && ' Check the terminal running `npm run dev` — it is printed there.'}
        </p>
      )}

      <form action={sendLink}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
        <button type="submit">Send sign-in link</button>
      </form>

      {consoleMode && (
        <p className="muted" style={{ marginTop: '2rem' }}>
          <strong>Dev mode:</strong> EMAIL_ADAPTER=console, so the link prints to your
          terminal instead of being emailed. No Resend account needed to develop.
        </p>
      )}
    </main>
  );
}
