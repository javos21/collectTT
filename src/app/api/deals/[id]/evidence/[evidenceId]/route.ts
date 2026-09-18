import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';
import { evidenceDownloadUrl } from '@/services/transaction-evidence';

export async function GET(_request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const user = await currentUser();
  if (user === null) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const { evidenceId } = await params;
  try {
    return NextResponse.redirect(await evidenceDownloadUrl(evidenceId, user.userId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evidence not found' }, { status: 404 });
  }
}
