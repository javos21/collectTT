import { z } from 'zod';

import { currentUser } from '@/lib/session';
import { setInitialOnboardingProfile } from '@/services/account-profile';

export async function POST(request: Request): Promise<Response> {
  const user = await currentUser();
  if (user === null) return Response.json({ message: 'Sign in required.' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = z.object({
    displayName: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(7).max(30),
  }).safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: 'Enter a display name and a valid mobile number.' }, { status: 400 });
  }

  try {
    await setInitialOnboardingProfile(user.userId, parsed.data.displayName, parsed.data.phone);
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : 'Could not save onboarding details.' }, { status: 409 });
  }
  return Response.json({ ok: true });
}
