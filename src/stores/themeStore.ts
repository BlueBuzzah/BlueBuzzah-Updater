import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Appearance } from '@/lib/theme';

interface ThemeStore {
  appearance: Appearance;
  /** null = follow the OS contrast setting */
  highContrast: boolean | null;
  setAppearance: (appearance: Appearance) => void;
  setHighContrast: (highContrast: boolean | null) => void;
}

// localStorage can throw (blocked or full); keep the choice in memory then.
const memory = new Map<string, string>();
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      appearance: 'system',
      highContrast: null,
      setAppearance: (appearance) => set({ appearance }),
      setHighContrast: (highContrast) => set({ highContrast }),
    }),
    { name: 'bb-theme', storage: createJSONStorage(() => safeStorage) }
  )
);
