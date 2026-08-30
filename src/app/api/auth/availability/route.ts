import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/db/schema/auth';
import { profiles } from '@/db/schema/profiles';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;

function json(data: Record<string, unknown>, init?: ResponseInit) {
  return Response.json(data, {
    headers: { 'Cache-Control': 'no-store' },
    ...init,
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const field = params.get('field');
  const rawValue = params.get('value') ?? '';

  if (field !== 'username' && field !== 'email') {
    return json({ message: 'Choose a valid field to check.' }, { status: 400 });
  }

  const value = field === 'email' ? rawValue.trim().toLowerCase() : rawValue.trim();
  const isValid = field === 'email' ? EMAIL_PATTERN.test(value) : USERNAME_PATTERN.test(value);
  if (!isValid) {
    return json({ available: false, message: `Enter a valid ${field}.` }, { status: 400 });
  }

  if (field === 'email') {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${value}`)
      .limit(1);

    return json({ available: existing[0] === undefined });
  }

  // New sign-ups are stored in `user.name` until their verified session creates
  // the domain profile. Check both tables so an unverified account cannot reserve
  // the same username as an existing member.
  const [existingUser, existingProfile] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.name}) = ${value.toLowerCase()}`)
      .limit(1),
    db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(
        sql`lower(${profiles.handle}) = ${value.toLowerCase()} or lower(${profiles.displayName}) = ${value.toLowerCase()}`,
      )
      .limit(1),
  ]);

  return json({ available: existingUser[0] === undefined && existingProfile[0] === undefined });
}
