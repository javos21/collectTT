import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/session';
import { confirmEvidence } from '@/services/transaction-evidence';

const schema = z.object({ evidenceId: z.string().uuid() });

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === null) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'evidenceId is required' }, { status: 400 });
  try {
    await confirmEvidence(parsed.data.evidenceId, user.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evidence confirmation failed' }, { status: 400 });
  }
}
