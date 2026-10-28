import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';

interface SwitchProps {
  label: string;
  description?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** The whole row is the target; the thumb shows a check when on. */
export function Switch({ label, description, checked, defaultChecked = false, onChange, disabled, id, className }: SwitchProps) {
  const [inner, setInner] = React.useState(defaultChecked);
  const on = checked ?? inner;
  const labelId = React.useId();
  const descId = `${labelId}-d`;
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={on}
      disabled={disabled}
      aria-labelledby={labelId}
      aria-describedby={description ? descId : undefined}
      className={cn('bb-switch', on && 'bb-switch--on', className)}
      onClick={() => {
        const next = !on;
        setInner(next);
        onChange?.(next);
      }}
    >
      <span className="bb-switch__text">
        <span className="bb-switch__label" id={labelId}>{label}</span>
        {description && <span className="bb-switch__desc" id={descId}>{description}</span>}
      </span>
      <span className="bb-switch__track" aria-hidden="true">
        <span className="bb-switch__thumb">{on && <Check size={ICON.badge} />}</span>
      </span>
    </button>
  );
}
