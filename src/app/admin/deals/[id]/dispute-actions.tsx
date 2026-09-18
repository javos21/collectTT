'use client';

import { useFormStatus } from 'react-dom';

import { reviewDisputeAction } from '@/app/admin/actions';

function ReviewButton({ decision }: { decision: 'resolved' | 'dismissed' }) {
  const { pending } = useFormStatus();
  const label = decision === 'resolved' ? 'Mark resolved' : 'Dismiss dispute';
  return (
    <button
      className={`admin-button${decision === 'dismissed' ? ' admin-button--secondary' : ''}`}
      type="submit"
      name="decision"
      value={decision}
      disabled={pending}
      onClick={(event) => {
        if (decision === 'dismissed' && !window.confirm('Dismiss this dispute? The decision will be recorded for both members.')) {
          event.preventDefault();
        }
      }}
    >
      {pending ? 'Recording decision…' : label}
    </button>
  );
}

export function DisputeAdminActions({
  disputeId,
  transactionId,
  reason,
  detail,
}: {
  disputeId: string;
  transactionId: string;
  reason: string;
  detail: string;
}) {
  const resolutionId = `dispute-resolution-${disputeId}`;
  const helpId = `${resolutionId}-help`;

  return (
    <article className="admin-dispute-action">
      <div className="admin-dispute-action__copy">
        <div>
          <span className="admin-status admin-status--pending">Open dispute</span>
          <strong>{reason}</strong>
        </div>
        <p>{detail}</p>
      </div>
      <form action={reviewDisputeAction}>
        <input type="hidden" name="disputeId" value={disputeId} />
        <input type="hidden" name="transactionId" value={transactionId} />
        <label htmlFor={resolutionId}>Decision note</label>
        <textarea
          id={resolutionId}
          name="resolution"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          aria-describedby={helpId}
          placeholder="Explain the evidence reviewed and the outcome."
        />
        <p id={helpId} className="admin-form-help">Required for the audit log and shared with both members.</p>
        <label htmlFor={`${resolutionId}-state`}>Deal outcome</label>
        <select id={`${resolutionId}-state`} name="nextState" defaultValue="open">
          <option value="open">Resume deal</option>
          <option value="completed">Complete deal (only when all confirmations are present)</option>
          <option value="cancelled">Cancel and release listing</option>
          <option value="expired">Expire and release listing</option>
        </select>
        <div className="admin-dispute-action__buttons">
          <ReviewButton decision="resolved" />
          <ReviewButton decision="dismissed" />
        </div>
      </form>
    </article>
  );
}
