'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';

interface PasswordFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

function EyeIcon({ crossed = false }: { crossed?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 12s3.25-5 9.5-5 9.5 5 9.5 5-3.25 5-9.5 5-9.5-5-9.5-5Z" />
      <circle cx="12" cy="12" r="2.25" />
      {crossed && <path d="m4 4 16 16" />}
    </svg>
  );
}

export function PasswordField({ label, id, ...inputProps }: PasswordFieldProps) {
  const generatedId = useId();
  const [visible, setVisible] = useState(false);
  const inputId = id ?? generatedId;

  return (
    <div className="password-field">
      <input {...inputProps} id={inputId} type={visible ? 'text' : 'password'} />
      <button
        className="password-toggle"
        type="button"
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        <EyeIcon crossed={visible} />
        <span className="sr-only">{visible ? `Hide ${label}` : `Show ${label}`}</span>
      </button>
    </div>
  );
}
