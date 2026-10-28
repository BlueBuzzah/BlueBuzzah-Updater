import * as React from 'react';
import { OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Ports, versions, serial numbers */
  mono?: boolean;
}

/** Label above, hint below, error tied by aria-describedby. */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, hint, error, mono, id, className, ...rest }, ref) => {
    const autoId = React.useId();
    const fieldId = id ?? autoId;
    const hintId = `${fieldId}-hint`;
    const errId = `${fieldId}-err`;
    const described = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
    return (
      <div className={cn('bb-field', error && 'bb-field--error', className)}>
        <label className="bb-field__label" htmlFor={fieldId}>{label}</label>
        <input
          type="text"
          ref={ref}
          {...rest}
          id={fieldId}
          className={cn('bb-field__input', mono && 'bb-field__input--mono')}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
        />
        {hint && <p className="bb-field__hint" id={hintId}>{hint}</p>}
        {error && (
          <p className="bb-field__error" id={errId}>
            <OctagonAlert size={ICON.s} />
            <span>{error}</span>
          </p>
        )}
      </div>
    );
  }
);
TextField.displayName = 'TextField';
