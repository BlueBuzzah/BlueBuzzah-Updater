import * as React from 'react';
import { ChevronDown, ChevronUp, Copy, Save } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface LogPaneProps {
  lines: string[];
  fileName?: string;
  /** Shown at the end of the Show Log row, or of the Copy/Save row when collapsible is false */
  actions?: React.ReactNode;
  /** false: always open, no Show/Hide Log, and the list fills its flex parent with its own scroll */
  collapsible?: boolean;
  /** Accessible name of the scrolling list (collapsible={false}), e.g. "BlueBuzzah v2 /dev/cu.x log" */
  label?: string;
  /** Epoch ms per line, parallel to lines; shown as local HH:MM:SS.mmm and included in Copy and Save */
  timestamps?: number[];
  /** Scroll to the newest line whenever lines change; when off, the line at the top stays put */
  follow?: boolean;
  /** Number of the first line shown, for logs that drop their oldest lines */
  firstLineNumber?: number;
  /** Called after a successful Copy or Save */
  onExport?: () => void;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Local wall-clock time, HH:MM:SS.mmm. */
export function formatLogTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Index of the first row whose bottom is below scrollTop; rows are in top order. */
export function firstVisibleRow(rows: ArrayLike<{ offsetTop: number; offsetHeight: number }>, scrollTop: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].offsetTop + rows[mid].offsetHeight <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The line at the top of the view and how far it sat from the scroll position. */
interface Anchor {
  line: number;
  offset: number;
}

// Memoized and keyed by line number: a new batch renders only its own rows, and each time is formatted once.
const LogRow = React.memo(function LogRow({ n, t, text, numberWidth }: { n: number; t?: number; text: string; numberWidth: string }) {
  return (
    <li data-line={n} className="flex gap-3">
      <span className="shrink-0 text-right tabular-nums text-ink-muted" style={{ minWidth: numberWidth }}>{n}</span>
      {t !== undefined && <span className="shrink-0 tabular-nums text-ink-muted">{formatLogTime(t)}</span>}
      <span className="min-w-0 whitespace-pre-wrap">{text}</span>
    </li>
  );
});

/** updater.md Logs: code-s on surface-sunken, line numbers, Copy and Save. */
export function LogPane({
  lines,
  fileName = 'bluebuzzah-updater-log.txt',
  actions,
  collapsible = true,
  label,
  timestamps,
  follow = false,
  firstLineNumber = 1,
  onExport,
}: LogPaneProps) {
  const [expanded, setExpanded] = React.useState(false);
  const open = !collapsible || expanded;
  const [status, setStatus] = React.useState('');
  const paneId = React.useId();
  const listRef = React.useRef<HTMLOListElement>(null);
  const anchor = React.useRef<Anchor | null>(null);
  // code-s is monospace, so 1ch is one digit: the column fits the largest line number.
  const numberWidth = `${String(firstLineNumber + Math.max(lines.length - 1, 0)).length}ch`;

  const recordAnchor = () => {
    const list = listRef.current;
    if (!list || list.children.length === 0) return;
    const rows = list.children as HTMLCollectionOf<HTMLElement>;
    const row = rows[firstVisibleRow(rows, list.scrollTop)];
    anchor.current = { line: Number(row.dataset.line), offset: row.offsetTop - list.scrollTop };
  };

  // Before paint, so a followed log never shows the old position for a frame. When not
  // following, dropping old rows would slide the text being read upward (WebKit has no
  // scroll anchoring), so the line that was at the top is put back where it was.
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (follow) {
      list.scrollTop = list.scrollHeight;
    } else if (anchor.current) {
      const row = list.querySelector<HTMLElement>(`[data-line="${anchor.current.line}"]`);
      if (row) list.scrollTop = row.offsetTop - anchor.current.offset;
    }
    recordAnchor();
  }, [lines, follow, open]);

  const text = () => lines.map((line, i) => (timestamps?.[i] === undefined ? line : `${formatLogTime(timestamps[i])} ${line}`)).join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setStatus('Log copied.');
      onExport?.();
    } catch {
      setStatus("Couldn't copy the log.");
    }
  };
  const saveLog = async () => {
    try {
      const path = await save({ defaultPath: fileName });
      if (!path) return;
      await writeTextFile(path, text());
      setStatus('Log saved.');
      onExport?.();
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
          {/* relative: rows' offsetTop is measured from the list. A scrolling list takes focus so the keyboard can scroll it (WebKit doesn't). */}
          <ol
            ref={listRef}
            onScroll={recordAnchor}
            tabIndex={collapsible ? undefined : 0}
            aria-label={collapsible ? undefined : label}
            className={cn('code-s relative m-0 grid list-none content-start gap-1 rounded-md bg-surface-sunken p-4', !collapsible && 'min-h-0 flex-1 overflow-y-auto')}
          >
            {lines.map((line, i) => (
              <LogRow key={firstLineNumber + i} n={firstLineNumber + i} t={timestamps?.[i]} text={line} numberWidth={numberWidth} />
            ))}
          </ol>
        </div>
      )}
      <p className="body-s" aria-live="polite">{status}</p>
    </div>
  );
}
