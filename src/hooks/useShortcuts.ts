import { useEffect } from 'react';

export type Section = 'firmware' | 'configure' | 'settings';

const SECTION_KEYS: Record<string, Section> = { '1': 'firmware', '2': 'configure', '3': 'settings' };

export const isMac = () => navigator.platform.startsWith('Mac');

/** ⌘/Ctrl+1–3 switch sections, ⌘/Ctrl+R rescans devices (updater.md Keyboard). */
export function useShortcuts({ onSection, onRescan, enabled }: { onSection: (s: Section) => void; onRescan: () => void; enabled: boolean }): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(isMac() ? e.metaKey : e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (!(key in SECTION_KEYS) && key !== 'r') return;
      e.preventDefault();
      if (!enabled) return;
      if (key === 'r') onRescan();
      else onSection(SECTION_KEYS[key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSection, onRescan, enabled]);
}
