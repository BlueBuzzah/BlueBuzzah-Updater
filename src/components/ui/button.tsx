import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';
type Size = 'md' | 'lg' | 'xl';

// ponytail: legacy shadcn names kept only until every screen moves to the
// design-system names (removed in the cleanup task).
type LegacyVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'link';
type LegacySize = 'default' | 'sm' | 'icon';
const LEGACY_VARIANT: Record<LegacyVariant, Variant> = {
  default: 'primary',
  outline: 'secondary',
  ghost: 'quiet',
  destructive: 'danger',
  link: 'quiet',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | LegacyVariant;
  size?: Size | LegacySize;
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
    const v = variant in LEGACY_VARIANT ? LEGACY_VARIANT[variant as LegacyVariant] : (variant as Variant);
    const s: Size = size === 'lg' || size === 'xl' ? size : 'md';
    const guard = guardRepeat ?? s === 'xl';
    const last = React.useRef(0);
    const iconSize = s === 'xl' ? ICON.l : ICON.m;
    return (
      <button
        type="button"
        ref={ref}
        {...rest}
        className={cn('bb-btn', `bb-btn--${v}`, `bb-btn--${s}`, fullWidth && 'bb-btn--full', className)}
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

/** @deprecated legacy shadcn helper for alert-dialog; removed when it's rebuilt. */
export const buttonVariants = ({ variant = 'primary' }: { variant?: ButtonProps['variant'] } = {}) =>
  cn('bb-btn', `bb-btn--${variant in LEGACY_VARIANT ? LEGACY_VARIANT[variant as LegacyVariant] : variant}`, 'bb-btn--md');
