import type { ReactNode } from 'react';
import { Check, Hand } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICON } from './icon';

interface DeviceCardProps {
  /** Device label, e.g. "BlueBuzzah v2" */
  name: string;
  role?: 'PRIMARY' | 'SECONDARY';
  board?: string;
  port: string;
  serial?: string;
  firmware?: string;
  /** Usually a StatusBadge */
  status?: ReactNode;
  /** Words for `status`, included in the accessible name */
  statusLabel?: string;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

const ROLE_NAME = { PRIMARY: 'Primary device', SECONDARY: 'Secondary device' } as const;

/**
 * GloveStatus markup for a USB device. Before a role is chosen it's named by
 * its board; after, "Primary device" / "Secondary device" (GloveStatus README).
 */
export function DeviceCard({ name, role, board, port, serial, firmware, status, statusLabel, selected, onSelect, className }: DeviceCardProps) {
  const display = role ? ROLE_NAME[role] : name;
  const secondary = role ? name : undefined;
  const boardLine = board && board !== display && board !== secondary ? board : undefined;
  const label = [display, secondary, boardLine, `port ${port}`, statusLabel, selected ? 'selected' : null].filter(Boolean).join(', ');
  const body = (
    <>
      <div className="bb-glove__top">
        <div className="flex min-w-0 items-center gap-3">
          <span className="bb-glove__hand shrink-0"><Hand size={ICON.l} /></span>
          <div className="min-w-0">
            <p className="bb-glove__name mt-0">{display}</p>
            {secondary && <p className="body-s">{secondary}</p>}
            {boardLine && <p className="body-s">{boardLine}</p>}
          </div>
        </div>
        {selected && <span className="bb-glove__check shrink-0"><Check size={ICON.s} /></span>}
      </div>
      {status}
      <p className="code-s text-ink-muted">Port {port}</p>
      {serial && <p className="code-s text-ink-muted">Serial number {serial}</p>}
      {firmware && <p className="bb-glove__fw">Firmware {firmware}</p>}
    </>
  );
  const classes = cn('bb-glove', selected && 'bb-glove--selected', onSelect && 'bb-glove--selectable', className);
  return onSelect ? (
    <button type="button" className={classes} aria-pressed={!!selected} aria-label={label} onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className={classes} role="group" aria-label={label}>
      {body}
    </div>
  );
}
