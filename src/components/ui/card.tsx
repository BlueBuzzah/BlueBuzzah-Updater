import * as React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  as?: 'section' | 'article' | 'div' | 'li';
  title?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  /** lg (default) for the Updater (Card README: desktop) */
  padding?: 'md' | 'lg';
  elevated?: boolean;
}

export function Card({ as: Tag = 'section', title, eyebrow, actions, padding = 'lg', elevated = true, className, children, ...rest }: CardProps) {
  const titleId = React.useId();
  return (
    <Tag
      {...rest}
      className={cn('bb-card', padding === 'lg' && 'bb-card--lg', !elevated && 'bb-card--flat', className)}
      aria-labelledby={title ? titleId : undefined}
    >
      {(title || actions) && (
        <header className="bb-card__head">
          <div>
            {eyebrow && <p className="bb-card__eyebrow">{eyebrow}</p>}
            {title && <h3 className="bb-card__title" id={titleId}>{title}</h3>}
          </div>
          {actions && <div className="bb-card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}
