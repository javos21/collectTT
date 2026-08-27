import type { ReactNode } from 'react';

interface AuthFeedbackProps {
  tone: 'error' | 'info';
  children: ReactNode;
}

function FeedbackIcon({ tone }: { tone: AuthFeedbackProps['tone'] }) {
  return tone === 'error' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.25h.01" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.25 2.5 2.5 5.5-5.5" />
    </svg>
  );
}

export function AuthFeedback({ tone, children }: AuthFeedbackProps) {
  return (
    <div className={`auth-feedback auth-feedback--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <FeedbackIcon tone={tone} />
      <span>{children}</span>
    </div>
  );
}
