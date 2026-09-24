'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type CopyStatus = 'idle' | 'copied' | 'error';

export function CopyPhoneButton({ phoneNumber }: { phoneNumber: string }) {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
  }, []);

  const resetLater = () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setStatus('idle'), 2500);
  };

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(phoneNumber);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
    resetLater();
  };

  return (
    <button className="deal-contact-card__copy" type="button" onClick={copyNumber} aria-live="polite">
      {status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span>{status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : 'Copy number'}</span>
    </button>
  );
}
