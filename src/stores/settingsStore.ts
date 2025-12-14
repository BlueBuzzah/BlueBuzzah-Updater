import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { AdvancedSettings } from '@/types';

/**
 * Default advanced settings values.
 * Used when no settings have been saved yet.
 */
const defaultSettings: AdvancedSettings = {
  disableLedDuringTherapy: false,
  debugMode: false,
};

interface SettingsStore {
  // State
  settings: AdvancedSettings;
  isLoaded: boolean;
  isSyncing: boolean;

  // Actions
  setSettings: (settings: Partial<AdvancedSettings>) => void;
  loadFromBackend: () => Promise<void>;
  syncToBackend: () => Promise<void>;
  reset: () => void;
}

/**
 * Settings store with dual persistence:
 * - Frontend: Zustand persist to localStorage (immediate)
 * - Backend: JSON file in app data directory (durable)
 *
 * The backend is the source of truth. On app start, we load from backend.
 * When settings change, we sync to backend asynchronously.
 */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      isLoaded: false,
      isSyncing: false,

      /**
       * Update settings and sync to backend.
       * Accepts partial settings - only updates specified fields.
       */
      setSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
        // Auto-sync to backend (fire and forget, don't block UI)
        get().syncToBackend();
      },

      /**
       * Load settings from backend on app startup.
       * Backend is the source of truth, so this overrides localStorage values.
       */
      loadFromBackend: async () => {
        try {
          const settings = await invoke<AdvancedSettings>('get_advanced_settings');
          set({ settings, isLoaded: true });
        } catch (error) {
          console.error('[SettingsStore] Failed to load settings from backend:', error);
          // Use localStorage fallback if backend fails
          set({ isLoaded: true });
        }
      },

      /**
       * Sync current settings to backend for durable persistence.
       * Called automatically when settings change.
       */
      syncToBackend: async () => {
        const { settings, isSyncing } = get();
        if (isSyncing) return;

        set({ isSyncing: true });
        try {
          await invoke('save_advanced_settings', { settings });
        } catch (error) {
          console.error('[SettingsStore] Failed to sync settings to backend:', error);
        } finally {
          set({ isSyncing: false });
        }
      },

      /**
       * Reset settings to defaults and sync to backend.
       */
      reset: () => {
        set({ settings: defaultSettings });
        get().syncToBackend();
      },
    }),
    {
      name: 'bluebuzzah-settings',
      storage: createJSONStorage(() => localStorage),
      // Only persist the settings object, not loading/syncing state
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);

/**
 * Hook to initialize settings from backend on app startup.
 * Should be called once in a top-level component.
 */
export function useInitializeSettings() {
  const loadFromBackend = useSettingsStore((s) => s.loadFromBackend);
  const isLoaded = useSettingsStore((s) => s.isLoaded);

  // Load from backend once on mount
  if (!isLoaded) {
    loadFromBackend();
  }

  return isLoaded;
}
