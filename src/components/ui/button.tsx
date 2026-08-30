'use client';

import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

import { cx } from '@/lib/cx';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;
type ButtonColor = 'primary' | 'secondary' | 'tertiary' | 'link' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<AriaButtonProps, 'children' | 'className'> {
  children: ReactNode;
  className?: string;
  color?: ButtonColor;
  size?: ButtonSize;
  iconLeading?: IconComponent;
  iconTrailing?: IconComponent;
}

const colorClasses: Record<ButtonColor, string> = {
  primary: 'ui-button--primary',
  secondary: 'ui-button--secondary',
  tertiary: 'ui-button--tertiary',
  link: 'ui-button--link',
  destructive: 'ui-button--destructive',
};

export function Button({
  children,
  className,
  color = 'primary',
  size = 'md',
  iconLeading: IconLeading,
  iconTrailing: IconTrailing,
  ...props
}: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={cx('ui-button', colorClasses[color], `ui-button--${size}`, className)}
    >
      {IconLeading && <IconLeading aria-hidden="true" className="ui-button__icon" />}
      <span>{children}</span>
      {IconTrailing && <IconTrailing aria-hidden="true" className="ui-button__icon" />}
    </AriaButton>
  );
}
