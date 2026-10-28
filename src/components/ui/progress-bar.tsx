import * as React from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  label: React.ReactNode;
  value: number;
  max?: number;
  /** The current step, in plain words */
  detail?: React.ReactNode;
  tone?: 'brand' | 'success' | 'danger';
  className?: string;
}

/** Determinate progress with the percentage always in text. */
export function ProgressBar({ label, value, max = 100, detail, tone, className }: ProgressBarProps) {
  const labelId = React.useId();
  const pct = Math.round((Math.max(0, Math.min(max, value || 0)) / max) * 100);
  return (
    <div className={cn('bb-progress', tone && `bb-progress--${tone}`, className)}>
      <div className="bb-progress__head">
        <span className="bb-progress__label" id={labelId}>{label}</span>
        <span className="bb-progress__value">{pct}%</span>
      </div>
      <div className="bb-progress__track" role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="bb-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {detail && <p className="bb-progress__detail">{detail}</p>}
    </div>
  );
}
