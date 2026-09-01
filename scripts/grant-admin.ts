/** Promote one existing local account to the admin role. */

import '../src/lib/load-env';
import { eq } from 'drizzle-orm';

import { db, pool } from '../src/db/client';
import { users } from '../src/db/schema/auth';
import { profiles } from '../src/db/schema/profiles';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1')) {
    throw new Error('Refusing to change roles outside a local database.');
  }

  const email = process.argv[2]?.trim().toLowerCase();
  if (email === undefined || email === '') {
    throw new Error('Usage: npm run admin:grant -- user@example.com');
  }

  const userRows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0];
  if (user === undefined) throw new Error(`No local account found for ${email}.`);

  const updated = await db.update(profiles).set({ role: 'admin' }).where(eq(profiles.userId, user.id)).returning({ userId: profiles.userId });
  if (updated[0] === undefined) throw new Error(`No profile found for ${email}.`);

  console.log(`[admin] ${user.name} (${email}) can now access http://localhost:3000/admin`);
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error('[admin] failed', error);
  await pool.end();
  process.exit(1);
});
