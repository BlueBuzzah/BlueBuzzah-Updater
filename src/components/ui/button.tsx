import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'md' | 'lg' | 'xl';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconEnd?: LucideIcon;
  fullWidth?: boolean;
  /** Ignore repeat activations within 400ms. Defaults to true for size xl. */
  guardRepeat?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', icon: Icon, iconEnd: IconEnd, fullWidth, guardRepeat, className, children, onClick, ...rest },
    ref
  ) => {
    const guard = guardRepeat ?? size === 'xl';
    const last = React.useRef(0);
    const iconSize = size === 'xl' ? ICON.l : ICON.m;
    return (
      <button
        type="button"
        ref={ref}
        {...rest}
        className={cn('bb-btn', `bb-btn--${variant}`, `bb-btn--${size}`, fullWidth && 'bb-btn--full', className)}
        onClick={(e) => {
          const now = Date.now();
          if (guard && now - last.current < 400) {
            e.preventDefault();
            return;
          }
          last.current = now;
          onClick?.(e);
        }}
      >
        {Icon && <Icon size={iconSize} />}
        <span className="bb-btn__label">{children}</span>
        {IconEnd && <IconEnd size={iconSize} />}
      </button>
    );
  }
);
Button.displayName = 'Button';
