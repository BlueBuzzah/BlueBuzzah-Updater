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
    <div className="flex min-h-screen flex-col bg-surface text-ink md:h-screen md:flex-row md:overflow-hidden">
      <Sidebar section={section} onSectionChange={onSectionChange} busy={busy} />
      <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
        <header data-tauri-drag-region className={cn('px-4 py-6 md:px-10', busy ? 'bg-abyss text-on-abyss' : 'bg-surface')}>
          <h1 className="headline">{title}</h1>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-10">{children}</main>
      </div>
    </div>
  );
}
