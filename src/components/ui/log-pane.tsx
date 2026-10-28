import * as React from 'react';
import { ChevronDown, ChevronUp, Copy, Save } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Button } from './button';
import { TextField } from './text-field';

interface LogPaneProps {
  lines: string[];
  fileName?: string;
}

/** updater.md Logs: code-s on surface-sunken, line numbers, Copy, Save and a filter. */
export function LogPane({ lines, fileName = 'bluebuzzah-updater-log.txt' }: LogPaneProps) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [status, setStatus] = React.useState('');
  const paneId = React.useId();
  const text = lines.join('\n');
  const needle = filter.trim().toLowerCase();
  const shown = lines.map((line, i) => ({ n: i + 1, line })).filter(({ line }) => !needle || line.toLowerCase().includes(needle));

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

  return (
    <div className="grid gap-4">
      <div>
        <Button variant="quiet" icon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={paneId} onClick={() => setOpen(!open)}>
          {open ? 'Hide log' : 'Show log'}
        </Button>
      </div>
      {open && (
        <div id={paneId} className="grid gap-4">
          <div className="flex flex-wrap items-end gap-target-gap">
            <TextField className="min-w-0 flex-1" label="Filter log" hint="Shows lines that contain this text." value={filter} onChange={(e) => setFilter(e.target.value)} />
            <Button variant="secondary" icon={Copy} onClick={copy}>Copy log</Button>
            <Button variant="secondary" icon={Save} onClick={saveLog}>Save log</Button>
          </div>
          <ol className="code-s m-0 grid list-none gap-1 rounded-md bg-surface-sunken p-4">
            {shown.map(({ n, line }) => (
              <li key={n} className="flex gap-3">
                <span className="text-ink-muted">{n}</span>
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
