import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';
import { TONE_ICON } from './status-badge';

interface BannerProps {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  /** Usually one quiet or secondary Button. */
  action?: ReactNode;
  icon?: LucideIcon;
  /** Announce when it appears (status; alert for danger). */
  announce?: boolean;
  className?: string;
}

export function Banner({ tone = 'info', title, children, action, icon, announce, className }: BannerProps) {
  const Icon = icon ?? TONE_ICON[tone];
  const role = announce ? (tone === 'danger' ? 'alert' : 'status') : undefined;
  return (
    <div className={cn('bb-banner', `bb-banner--${tone}`, className)} role={role}>
      <Icon size={ICON.banner} className="bb-banner__icon" />
      <div className="bb-banner__body">
        {title && <p className="bb-banner__title">{title}</p>}
        {children && <div className="bb-banner__text">{children}</div>}
        {action && <div className="bb-banner__action">{action}</div>}
      </div>
    </div>
  );
}
