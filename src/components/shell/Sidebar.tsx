import { Cpu, Settings, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import mark from '@/assets/bluebuzzah-mark-512.png';
import { ICON } from '@/components/ui/icon';
import { isMac, type Section } from '@/hooks/useShortcuts';
import type { BusyKind } from '@/stores/busy';
import { cn } from '@/lib/utils';

const ROWS: { id: Section; label: string; icon: LucideIcon; key: string }[] = [
  { id: 'firmware', label: 'Firmware', icon: Cpu, key: '1' },
  { id: 'configure', label: 'Configure', icon: SlidersHorizontal, key: '2' },
  { id: 'settings', label: 'Settings', icon: Settings, key: '3' },
];

const LOCKED: Record<BusyKind, string> = {
  flash: 'Available when the flash finishes',
  configure: 'Available when setup finishes',
};

interface SidebarProps {
  section: Section;
  onSectionChange: (s: Section) => void;
  busy: BusyKind | null;
}

export function Sidebar({ section, onSectionChange, busy }: SidebarProps) {
  const mac = isMac();
  const row = (r: (typeof ROWS)[number]) => {
    const current = r.id === section;
    return (
      <button
        key={r.id}
        type="button"
        disabled={!!busy && !current}
        aria-current={current ? 'page' : undefined}
        aria-keyshortcuts={`${mac ? 'Meta' : 'Control'}+${r.key}`}
        onClick={() => onSectionChange(r.id)}
        className={cn(
          'label flex min-h-target w-full items-center gap-3 rounded-md px-4 text-left text-ink disabled:text-ink-disabled',
          current && 'bg-brand-soft text-brand'
        )}
      >
        <r.icon size={ICON.m} />
        <span className="flex-1">{r.label}</span>
        <span className="caption text-ink-muted" aria-hidden="true">
          {mac ? `⌘${r.key}` : `Ctrl+${r.key}`}
        </span>
      </button>
    );
  };
  return (
    <aside className="flex w-sidebar shrink-0 flex-col gap-6 border-r border-line bg-surface-raised p-4">
      <div data-tauri-drag-region className={cn('flex items-center gap-3 p-2', mac && 'pt-12')}>
        <img src={mark} alt="" className="h-8 w-auto" />
        <span>
          <span className="title-m font-display text-ink">BlueBuzzah</span>{' '}
          <span className="title-m font-display font-normal text-ink-muted">Updater</span>
        </span>
      </div>
      <nav aria-label="Sections" className="flex flex-1 flex-col gap-3">
        {ROWS.slice(0, 2).map(row)}
        <div className="mt-auto grid gap-3">
          {busy && <p className="caption text-ink-muted">{LOCKED[busy]}</p>}
          {row(ROWS[2])}
        </div>
      </nav>
    </aside>
  );
}
