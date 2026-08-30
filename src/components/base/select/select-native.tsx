'use client';

import type { SelectHTMLAttributes } from 'react';

import { cx } from '@/lib/cx';

interface NativeSelectOption {
  label: string;
  value: string;
}

interface NativeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: readonly NativeSelectOption[];
  size?: 'sm' | 'md' | 'lg';
}

export function NativeSelect({ options, size = 'md', className, ...props }: NativeSelectProps) {
  return (
    <select {...props} className={cx('native-select', `native-select--${size}`, className)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
