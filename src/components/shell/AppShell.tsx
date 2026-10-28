import type { ReactNode } from 'react';
import type { Section } from '@/hooks/useShortcuts';
import type { BusyKind } from '@/stores/busy';
import { cn } from '@/lib/utils';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  section: Section;
  onSectionChange: (s: Section) => void;
  title: string;
  busy: BusyKind | null;
  children: ReactNode;
}

/** updater.md Window and layout; the header band turns abyss while running. */
export function AppShell({ section, onSectionChange, title, busy, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-surface text-ink">
      <Sidebar section={section} onSectionChange={onSectionChange} busy={busy} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className={cn('px-10 py-6', busy ? 'bg-abyss text-on-abyss' : 'bg-surface')}>
          <h1 className="headline">{title}</h1>
        </header>
        <main className="min-w-0 flex-1 p-10">{children}</main>
      </div>
    </div>
  );
}
