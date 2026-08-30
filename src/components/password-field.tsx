'use client';

import { useId, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from '@untitledui/icons';

interface PasswordFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
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
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        <span className="sr-only">{visible ? `Hide ${label}` : `Show ${label}`}</span>
      </button>
    </div>
  );
}
