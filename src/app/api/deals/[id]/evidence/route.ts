import { NextResponse } from 'next/server';
import { z } from 'zod';

import { currentUser } from '@/lib/session';
import { createEvidenceUploadTicket } from '@/services/transaction-evidence';

const schema = z.object({ contentType: z.string().min(1), originalFilename: z.string().max(255).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (user === null) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'contentType is required' }, { status: 400 });
  try {
    const ticket = await createEvidenceUploadTicket({ userId: user.userId, transactionId: id, ...parsed.data });
    return NextResponse.json(ticket);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evidence upload failed' }, { status: 400 });
  }
}
