import * as React from 'react';
import { ChevronDown, ChevronUp, Copy, Save } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Button } from './button';

interface LogPaneProps {
  lines: string[];
  fileName?: string;
  /** Shown at the end of the Show Log row */
  actions?: React.ReactNode;
}

/** updater.md Logs: code-s on surface-sunken, line numbers, Copy and Save. */
export function LogPane({ lines, fileName = 'bluebuzzah-updater-log.txt', actions }: LogPaneProps) {
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const paneId = React.useId();
  const text = lines.join('\n');

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
      <div className="flex flex-wrap items-center justify-between gap-target-gap">
        <Button variant="quiet" icon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={paneId} onClick={() => setOpen(!open)}>
          {open ? 'Hide Log' : 'Show Log'}
        </Button>
        {actions}
      </div>
      {open && (
        <div id={paneId} className="grid gap-4">
          <div className="flex flex-wrap gap-target-gap">
            <Button variant="secondary" icon={Copy} onClick={copy}>Copy Log</Button>
            <Button variant="secondary" icon={Save} onClick={saveLog}>Save Log</Button>
          </div>
          <ol className="code-s m-0 grid list-none gap-1 rounded-md bg-surface-sunken p-4">
            {lines.map((line, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-ink-muted">{i + 1}</span>
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
