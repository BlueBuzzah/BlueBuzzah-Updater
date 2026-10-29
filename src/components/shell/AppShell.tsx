import type { ReactNode } from 'react';
import type { Section } from '@/hooks/useShortcuts';
import type { BusyKind } from '@/stores/busy';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  section: Section;
  onSectionChange: (s: Section) => void;
  title: string;
  busy: BusyKind | null;
  children: ReactNode;
}

/** updater.md Window and layout; the abyss header band stays pinned at the top of every page. */
export function AppShell({ section, onSectionChange, title, busy, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink md:h-screen md:flex-row md:overflow-hidden">
      <Sidebar section={section} onSectionChange={onSectionChange} busy={busy} />
      <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
        <header data-tauri-drag-region className="sticky top-0 z-10 bg-abyss px-4 py-4 text-on-abyss md:px-10">
          <h1 className="title-l">{title}</h1>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-10">{children}</main>
      </div>
    </div>
  );
}
