import { redirect } from 'next/navigation';

import { safeAuthReturnTo } from '@/lib/auth-redirect';
import { currentUser } from '@/lib/session';
import { env } from '@/lib/env';
import { AuthShell } from '@/components/auth-shell';
import { AuthPanel } from './auth-panel';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  const params = await searchParams;
  const returnTo = safeAuthReturnTo(params.returnTo);
  const initialMode = params.mode === 'sign-up' ? 'sign-up' : 'sign-in';
  if (user !== null) redirect(returnTo);

  return (
    <AuthShell>
      <AuthPanel
        callbackURL={returnTo}
        consoleMode={env().EMAIL_ADAPTER === 'console'}
        initialMode={initialMode}
      />
    </AuthShell>
  );
}
