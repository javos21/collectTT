'use client';

import { useFormStatus } from 'react-dom';

import { retryNotificationDeliveryAction } from '@/app/admin/actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="admin-button" type="submit" disabled={pending}>
      {pending ? 'Queueing retry…' : 'Queue email retry'}
    </button>
  );
}

export function RetryDeliveryForm({ deliveryId }: { deliveryId: string }) {
  return (
    <form className="admin-retry-form" action={retryNotificationDeliveryAction}>
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <label htmlFor="retry-reason">Reason for retry</label>
      <textarea id="retry-reason" name="reason" required minLength={10} maxLength={500} rows={3} aria-describedby="retry-reason-help" />
      <p id="retry-reason-help" className="admin-form-help">Required for the audit log. Include the support context or correction that justifies another send.</p>
      <SubmitButton />
    </form>
  );
}
