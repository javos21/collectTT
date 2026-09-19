'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  revalidatePath('/', 'layout');
  redirect('/');
}
