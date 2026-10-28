import type { ReactNode } from 'react';
import { CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export const TONE_ICON: Record<Exclude<Tone, 'neutral'>, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  info: Info,
  brand: Info,
};

interface StatusBadgeProps {
  tone?: Tone;
  /** Override the tone's icon; null shows a dot. */
  icon?: LucideIcon | null;
  children: ReactNode;
  className?: string;
}

/** One condition in one to three words, always with an icon. */
export function StatusBadge({ tone = 'neutral', icon, children, className }: StatusBadgeProps) {
  const Icon = icon === null ? null : (icon ?? (tone === 'neutral' ? null : TONE_ICON[tone]));
  return (
    <span className={cn('bb-badge', `bb-badge--${tone}`, className)}>
      {Icon ? <Icon size={ICON.badge} /> : <span className="bb-badge__dot" aria-hidden="true" />}
      <span>{children}</span>
    </span>
  );
}
