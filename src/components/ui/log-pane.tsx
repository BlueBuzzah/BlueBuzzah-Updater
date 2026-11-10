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
  /** Called when scrolling changes whether the list is at the newest line: false on scrolling up, true on reaching the bottom */
  onFollowChange?: (follow: boolean) => void;
  /** Number of the first line shown, for logs that drop their oldest lines */
  firstLineNumber?: number;
  /** Called after a successful Copy or Save with the number of the last line it included */
  onExport?: (through: number) => void;
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
// oneRow: the line never wraps (the list scrolls sideways) and its number and time stay pinned at the left.
const LogRow = React.memo(function LogRow({ n, t, text, numberWidth, oneRow }: { n: number; t?: number; text: string; numberWidth: string; oneRow: boolean }) {
  return (
    <li data-line={n} className={oneRow ? 'flex w-max min-w-full pr-4' : 'flex gap-3'}>
      <span className={cn('flex shrink-0 gap-3 text-ink-muted', oneRow && 'sticky left-0 bg-surface-sunken pl-4 pr-3')}>
        <span className="shrink-0 text-right tabular-nums" style={{ minWidth: numberWidth }}>{n}</span>
        {t !== undefined && <span className="bb-log__time tabular-nums">{formatLogTime(t)}</span>}
      </span>
      <span className={oneRow ? 'whitespace-pre' : 'min-w-0 whitespace-pre-wrap'}>{text}</span>
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
  onFollowChange,
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

  // Scrolling up stops auto-scroll (lines keep arriving); scrolling back to the bottom starts it again.
  // The follow scroll below lands on the bottom, so it never stops itself.
  const onScroll = () => {
    recordAnchor();
    const list = listRef.current;
    if (!list || !onFollowChange) return;
    // ponytail: 2px slack for fractional scroll positions on scaled displays
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 2;
    if (atBottom !== follow) onFollowChange(atBottom);
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
  // The line count is read with the text, so lines that arrive while the save dialog is open aren't counted as exported.
  const through = () => firstLineNumber + lines.length - 1;
  const copy = async () => {
    const last = through();
    try {
      await navigator.clipboard.writeText(text());
      setStatus('Log copied.');
      onExport?.(last);
    } catch {
      setStatus("Couldn't copy the log.");
    }
  };
  const saveLog = async () => {
    const last = through();
    const content = text();
    try {
      const path = await save({ defaultPath: fileName });
      if (!path) return;
      await writeTextFile(path, content);
      setStatus('Log saved.');
      onExport?.(last);
    } catch {
      setStatus("Couldn't save the log.");
    }
  };

  // No icons in a fixed pane: without them Copy and Save fit on one row in a narrow pane, leaving room for the log.
  const copySave = (
    <div className="flex flex-wrap gap-target-gap">
      <Button variant="secondary" icon={collapsible ? Copy : undefined} onClick={copy}>Copy Log</Button>
      <Button variant="secondary" icon={collapsible ? Save : undefined} onClick={saveLog}>Save Log</Button>
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
            onScroll={onScroll}
            tabIndex={collapsible ? undefined : 0}
            aria-label={collapsible ? undefined : label}
            className={cn(
              'code-s relative m-0 grid list-none content-start gap-1 rounded-md bg-surface-sunken',
              collapsible ? 'p-4' : 'bb-log min-h-0 flex-1 overflow-auto py-4'
            )}
          >
            {lines.map((line, i) => (
              <LogRow key={firstLineNumber + i} n={firstLineNumber + i} t={timestamps?.[i]} text={line} numberWidth={numberWidth} oneRow={!collapsible} />
            ))}
          </ol>
        </div>
      )}
      <p className="body-s" aria-live="polite">{status}</p>
    </div>
  );
}
