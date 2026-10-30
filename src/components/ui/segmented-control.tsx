import * as React from 'react';
import { cn } from '@/lib/utils';
import { arrowTarget } from './roving';

export interface SegmentedControlProps<T extends string> {
  label?: string;
  /** 2–4 options with short labels */
  options: { value: T; label: string }[];
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  className?: string;
  'aria-describedby'?: string;
}

/** A radio group: arrow keys move and select. */
export function SegmentedControl<T extends string>({ label, options, value, defaultValue, onChange, className, ...aria }: SegmentedControlProps<T>) {
  const [inner, setInner] = React.useState<T | undefined>(defaultValue);
  const current = value ?? inner;
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = React.useId();

  const pick = (i: number) => {
    const opt = options[i];
    setInner(opt.value);
    onChange?.(opt.value);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = arrowTarget(e, i, options.length);
    if (n === null) return;
    pick(n);
    refs.current[n]?.focus();
  };
  // With nothing selected, the first option takes Tab.
  const tabbable = Math.max(0, options.findIndex((o) => o.value === current));

  return (
    <div className={cn('bb-seg', className)}>
      {label && <span className="bb-seg__label" id={labelId}>{label}</span>}
      <div className="bb-seg__track" role="radiogroup" aria-labelledby={label ? labelId : undefined} aria-describedby={aria['aria-describedby']}>
        {options.map((o, i) => {
          const sel = o.value === current;
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
              className={cn('bb-seg__opt', sel && 'bb-seg__opt--on')}
              onClick={() => pick(i)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
