import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle } from '@untitledui/icons';

interface AuthFeedbackProps {
  tone: 'error' | 'info';
  children: ReactNode;
}

export function AuthFeedback({ tone, children }: AuthFeedbackProps) {
  return (
    <div className={`auth-feedback auth-feedback--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'error' ? <AlertCircle aria-hidden="true" /> : <CheckCircle aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}
