import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';
import { arrowTarget } from './roving';

export interface ChoiceOption<T extends string> {
  value: T;
  title: React.ReactNode;
  body?: React.ReactNode;
  badge?: React.ReactNode;
}

interface ChoiceGroupProps<T extends string> {
  label: string;
  options: ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * One choice among cards (versions, patterns). Plan choice PC-9: no
 * design-system component covers this; it borrows the selectable GloveStatus
 * styling and SegmentedControl's keyboard behavior.
 */
export function ChoiceGroup<T extends string>({ label, options, value, onChange, className }: ChoiceGroupProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const tabbable = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-3', className)}>
      {options.map((o, i) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            tabIndex={i === tabbable ? 0 : -1}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={cn('bb-glove bb-glove--selectable text-left', sel && 'bb-glove--selected')}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const n = arrowTarget(e, i, options.length);
              if (n === null) return;
              onChange(options[n].value);
              refs.current[n]?.focus();
            }}
          >
            <div className="bb-glove__top">
              <span className="bb-glove__name">{o.title}</span>
              {sel && <span className="bb-glove__check"><Check size={ICON.s} /></span>}
            </div>
            {o.badge}
            {o.body && <div className="body-s text-ink-muted">{o.body}</div>}
          </button>
        );
      })}
    </div>
  );
}
