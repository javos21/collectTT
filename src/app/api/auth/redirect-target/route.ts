import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { profiles } from '@/db/schema/profiles';
import { currentUser } from '@/lib/session';
import { safeAuthReturnTo } from '@/lib/auth-redirect';

export async function GET(request: Request) {
  const user = await currentUser();
  const returnTo = safeAuthReturnTo(new URL(request.url).searchParams.get('returnTo') ?? undefined);

  if (user === null) return NextResponse.json({ destination: returnTo }, { status: 401 });

  const profile = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.userId))
    .limit(1);

  const destination = profile[0]?.role === 'admin' && returnTo === '/' ? '/admin' : returnTo;
  return NextResponse.json({ destination }, { headers: { 'Cache-Control': 'no-store' } });
}
