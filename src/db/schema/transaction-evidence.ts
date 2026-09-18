/** Private evidence attached to a transaction. Evidence supports a review; it never
 * changes the authoritative payment state. Objects live in private S3/R2 storage. */

import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';
import { transactions } from './transactions';
import { transactionEvidenceStatusEnum, transactionEvidenceTypeEnum } from './enums';

export const transactionEvidence = pgTable(
  'transaction_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by').notNull().references(() => profiles.userId, { onDelete: 'cascade' }),
    type: transactionEvidenceTypeEnum('type').notNull().default('payment_screenshot'),
    status: transactionEvidenceStatusEnum('status').notNull().default('pending'),
    storageKey: text('storage_key').notNull().unique(),
    originalFilename: text('original_filename'),
    contentType: text('content_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [
    index('transaction_evidence_by_tx').on(t.transactionId, t.createdAt),
    index('transaction_evidence_by_uploader').on(t.uploadedBy, t.createdAt),
  ],
);
