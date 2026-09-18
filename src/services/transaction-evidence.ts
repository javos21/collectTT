import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db, type DbOrTx } from '@/db/client';
import { transactionEvidence } from '@/db/schema/transaction-evidence';
import { transactions } from '@/db/schema/transactions';
import { evidenceBucket, presignDownload, presignUpload, headObject } from '@/lib/storage';

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;

export interface EvidenceUploadTicket {
  evidenceId: string;
  uploadUrl: string;
  key: string;
  expiresInSeconds: number;
}

function assertContentType(contentType: string): void {
  if (!(ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(contentType.toLowerCase())) {
    throw new Error('Evidence must be a JPEG, PNG, or PDF.');
  }
}

async function transactionFor(executor: DbOrTx, transactionId: string) {
  const rows = await executor.select({
    id: transactions.id,
    buyerId: transactions.buyerId,
    sellerId: transactions.sellerId,
    state: transactions.state,
    settlementMethod: transactions.settlementMethod,
  }).from(transactions).where(eq(transactions.id, transactionId)).limit(1);
  return rows[0] ?? null;
}

/** Reserve a private object key. Upload bytes go directly to S3/R2. */
export async function createEvidenceUploadTicket(input: {
  userId: string;
  transactionId: string;
  contentType: string;
  originalFilename?: string | null;
}): Promise<EvidenceUploadTicket> {
  assertContentType(input.contentType);
  const transaction = await transactionFor(db, input.transactionId);
  if (transaction === null) throw new Error('Deal not found.');
  if (transaction.buyerId !== input.userId && transaction.sellerId !== input.userId) throw new Error('Not your deal.');
  if (transaction.buyerId !== input.userId) throw new Error('Only the buyer can upload payment evidence.');
  if (transaction.settlementMethod !== 'bank_transfer') throw new Error('Evidence uploads are only available for bank transfers.');
  if (transaction.state !== 'open') throw new Error('This deal is closed.');

  const evidenceId = randomUUID();
  const key = `transaction-evidence/${input.transactionId}/${evidenceId}`;
  await db.insert(transactionEvidence).values({
    id: evidenceId,
    transactionId: input.transactionId,
    uploadedBy: input.userId,
    type: 'payment_screenshot',
    status: 'pending',
    storageKey: key,
    originalFilename: input.originalFilename?.slice(0, 255) ?? null,
    contentType: input.contentType,
  });
  return {
    evidenceId,
    uploadUrl: await presignUpload({
      key,
      contentType: input.contentType,
      bucketName: evidenceBucket(),
    }),
    key,
    expiresInSeconds: 600,
  };
}

export async function confirmEvidence(evidenceId: string, userId: string): Promise<void> {
  const rows = await db.select().from(transactionEvidence).where(eq(transactionEvidence.id, evidenceId)).limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error('Evidence not found.');
  if (row.uploadedBy !== userId) throw new Error('Not your evidence.');
  if (row.status === 'ready') return;
  let stored: Awaited<ReturnType<typeof headObject>>;
  try {
    stored = await headObject(row.storageKey, evidenceBucket());
  } catch {
    throw new Error('Uploaded evidence could not be found in storage.');
  }
  if (stored.contentLength === undefined || stored.contentLength <= 0 || stored.contentLength > MAX_EVIDENCE_BYTES) {
    throw new Error('Evidence must be between 1 byte and 10 MB.');
  }
  if (stored.contentType !== undefined && stored.contentType.toLowerCase() !== row.contentType.toLowerCase()) {
    throw new Error('Uploaded evidence content type does not match the reserved upload.');
  }
  await db.update(transactionEvidence).set({
    status: 'ready',
    bytes: stored.contentLength,
    confirmedAt: new Date(),
  }).where(and(eq(transactionEvidence.id, evidenceId), eq(transactionEvidence.uploadedBy, userId), eq(transactionEvidence.status, 'pending')));
}

export async function evidenceForViewer(executor: DbOrTx, transactionId: string, userId: string) {
  const transaction = await transactionFor(executor, transactionId);
  if (transaction === null) throw new Error('Deal not found.');
  if (transaction.buyerId !== userId && transaction.sellerId !== userId) throw new Error('Not your deal.');
  return executor.select().from(transactionEvidence).where(and(
    eq(transactionEvidence.transactionId, transactionId),
    eq(transactionEvidence.status, 'ready'),
  ));
}

export async function evidenceDownloadUrl(evidenceId: string, userId: string): Promise<string> {
  const rows = await db.select({ evidence: transactionEvidence, transaction: transactions })
    .from(transactionEvidence)
    .innerJoin(transactions, eq(transactions.id, transactionEvidence.transactionId))
    .where(and(eq(transactionEvidence.id, evidenceId), eq(transactionEvidence.status, 'ready'))).limit(1);
  const row = rows[0];
  if (row === undefined) throw new Error('Evidence not found.');
  if (row.transaction.buyerId !== userId && row.transaction.sellerId !== userId) throw new Error('Not your deal.');
  return presignDownload(row.evidence.storageKey, 600, evidenceBucket());
}
