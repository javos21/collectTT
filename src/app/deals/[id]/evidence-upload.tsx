'use client';

import { useState } from 'react';

export function EvidenceUpload({ transactionId }: { transactionId: string }) {
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setStatus('Evidence must be 10 MB or smaller.');
      return;
    }
    setBusy(true);
    setStatus('Preparing upload…');
    try {
      const ticketResponse = await fetch(`/api/deals/${transactionId}/evidence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, originalFilename: file.name }),
      });
      const ticket = await ticketResponse.json() as { evidenceId?: string; uploadUrl?: string; error?: string };
      if (!ticketResponse.ok || ticket.evidenceId === undefined || ticket.uploadUrl === undefined) throw new Error(ticket.error ?? 'Could not prepare upload.');
      setStatus('Uploading…');
      const uploadResponse = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
      if (!uploadResponse.ok) throw new Error('Storage upload failed.');
      const confirmResponse = await fetch(`/api/deals/${transactionId}/evidence/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evidenceId: ticket.evidenceId }),
      });
      const confirmed = await confirmResponse.json() as { error?: string };
      if (!confirmResponse.ok) throw new Error(confirmed.error ?? 'Could not confirm upload.');
      setStatus('Evidence uploaded for support review.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deal-evidence-upload">
      <label htmlFor="payment-evidence">Attach payment screenshot (optional)</label>
      <input id="payment-evidence" type="file" accept="image/jpeg,image/png,application/pdf" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file !== undefined) void upload(file);
      }} />
      <p>Evidence helps support review; it does not prove that funds cleared. Maximum 10 MB.</p>
      {status !== '' && <small role="status">{status}</small>}
    </div>
  );
}
