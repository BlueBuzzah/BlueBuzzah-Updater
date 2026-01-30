import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from './settingsStore';
import { invoke } from '@tauri-apps/api/core';

describe('settingsStore', () => {
  beforeEach(() => {
    // Reset store between tests
    useSettingsStore.setState({
      settings: {
        disableLedDuringTherapy: false,
        debugMode: false,
        selectedProfile: null,
      },
      isLoaded: false,
      isSyncing: false,
      loadError: null,
    });
    vi.resetAllMocks();
  });

  describe('loadFromBackend', () => {
    it('sets loadError on failure', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Backend unavailable'));

      await useSettingsStore.getState().loadFromBackend();

      const state = useSettingsStore.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.loadError).toBe('Backend unavailable');
    });

    it('clears loadError on success', async () => {
      // Set an initial error
      useSettingsStore.setState({ loadError: 'Previous error' });

      vi.mocked(invoke).mockResolvedValueOnce({
        disableLedDuringTherapy: true,
        debugMode: false,
        selectedProfile: 'REGULAR',
      });

      await useSettingsStore.getState().loadFromBackend();

      const state = useSettingsStore.getState();
      expect(state.isLoaded).toBe(true);
      expect(state.loadError).toBeNull();
      expect(state.settings.disableLedDuringTherapy).toBe(true);
    });

    it('uses localStorage fallback when backend fails', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Failed'));

      await useSettingsStore.getState().loadFromBackend();

      // Should still mark as loaded (using localStorage fallback)
      expect(useSettingsStore.getState().isLoaded).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears loadError on reset', () => {
      useSettingsStore.setState({ loadError: 'Some error' });

      // Mock syncToBackend invoke
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      useSettingsStore.getState().reset();

      expect(useSettingsStore.getState().loadError).toBeNull();
    });
  });
});
