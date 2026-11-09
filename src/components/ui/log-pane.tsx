import * as React from 'react';
import { ChevronDown, ChevronUp, Copy, Save } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface LogPaneProps {
  lines: string[];
  fileName?: string;
  /** Shown at the end of the Show Log row */
  actions?: React.ReactNode;
  /** false: always open, no Show/Hide Log, and the list fills its flex parent with its own scroll */
  collapsible?: boolean;
  /** Epoch ms per line, parallel to lines; shown as local HH:MM:SS.mmm and included in Copy and Save */
  timestamps?: number[];
  /** Scroll to the newest line whenever lines change */
  follow?: boolean;
  /** Number of the first line shown, for logs that drop their oldest lines */
  firstLineNumber?: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Local wall-clock time, HH:MM:SS.mmm. */
export function formatLogTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** updater.md Logs: code-s on surface-sunken, line numbers, Copy and Save. */
export function LogPane({
  lines,
  fileName = 'bluebuzzah-updater-log.txt',
  actions,
  collapsible = true,
  timestamps,
  follow = false,
  firstLineNumber = 1,
}: LogPaneProps) {
  const [expanded, setExpanded] = React.useState(false);
  const open = !collapsible || expanded;
  const [status, setStatus] = React.useState('');
  const paneId = React.useId();
  const listRef = React.useRef<HTMLOListElement>(null);
  const time = (i: number) => (timestamps?.[i] === undefined ? null : formatLogTime(timestamps[i]));
  const text = lines.map((line, i) => (time(i) === null ? line : `${time(i)} ${line}`)).join('\n');
  // code-s is monospace, so 1ch is one digit: the column fits the largest line number.
  const numberWidth = `${String(firstLineNumber + Math.max(lines.length - 1, 0)).length}ch`;

  React.useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [lines, follow, open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Log copied.');
    } catch {
      setStatus("Couldn't copy the log.");
    }
  };
  const saveLog = async () => {
    try {
      const path = await save({ defaultPath: fileName });
      if (!path) return;
      await writeTextFile(path, text);
      setStatus('Log saved.');
    } catch {
      setStatus("Couldn't save the log.");
    }
  };

  const copySave = (
    <div className="flex flex-wrap gap-target-gap">
      <Button variant="secondary" icon={Copy} onClick={copy}>Copy Log</Button>
      <Button variant="secondary" icon={Save} onClick={saveLog}>Save Log</Button>
    </div>
  );

  return (
    <div className={collapsible ? 'grid gap-4' : 'flex min-h-0 flex-1 flex-col gap-4'}>
      {collapsible ? (
        <div className="flex flex-wrap items-center justify-between gap-target-gap">
          <Button variant="quiet" icon={expanded ? ChevronUp : ChevronDown} aria-expanded={expanded} aria-controls={paneId} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide Log' : 'Show Log'}
          </Button>
          {actions}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-target-gap">
          {copySave}
          {actions}
        </div>
      )}
      {open && (
        <div id={paneId} className={collapsible ? 'grid gap-4' : 'flex min-h-0 flex-1 flex-col'}>
          {collapsible && copySave}
          <ol ref={listRef} className={cn('code-s m-0 grid list-none content-start gap-1 rounded-md bg-surface-sunken p-4', !collapsible && 'min-h-0 flex-1 overflow-y-auto')}>
            {lines.map((line, i) => (
              <li key={firstLineNumber + i} className="flex gap-3">
                <span className="shrink-0 text-right tabular-nums text-ink-muted" style={{ minWidth: numberWidth }}>{firstLineNumber + i}</span>
                {time(i) !== null && <span className="shrink-0 tabular-nums text-ink-muted">{time(i)}</span>}
                <span className="min-w-0 whitespace-pre-wrap">{line}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="body-s" aria-live="polite">{status}</p>
    </div>
  );
}
