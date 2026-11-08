import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from './settingsStore';
import { invoke } from '@tauri-apps/api/core';
import { CUSTOM_DEFAULTS, LEGACY_CUSTOM_DEFAULTS } from '@/lib/therapy-bounds';

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

    it('drops a saved custom profile equal to the pre-#23 defaults', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        disableLedDuringTherapy: false,
        debugMode: false,
        customProfile: { ...LEGACY_CUSTOM_DEFAULTS },
      });

      await useSettingsStore.getState().loadFromBackend();

      expect(useSettingsStore.getState().settings.customProfile).toBeUndefined();
    });

    it('keeps a saved custom profile that differs from the pre-#23 defaults', async () => {
      const edited = { ...LEGACY_CUSTOM_DEFAULTS, session: 119 };
      vi.mocked(invoke).mockResolvedValueOnce({
        disableLedDuringTherapy: false,
        debugMode: false,
        customProfile: edited,
      });

      await useSettingsStore.getState().loadFromBackend();

      expect(useSettingsStore.getState().settings.customProfile).toEqual(edited);
    });

    it('uses localStorage fallback when backend fails', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Failed'));

      await useSettingsStore.getState().loadFromBackend();

      // Should still mark as loaded (using localStorage fallback)
      expect(useSettingsStore.getState().isLoaded).toBe(true);
    });

    it('drops the old defaults from the localStorage fallback too', async () => {
      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, customProfile: { ...LEGACY_CUSTOM_DEFAULTS } },
      });
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Failed'));

      await useSettingsStore.getState().loadFromBackend();

      expect(useSettingsStore.getState().settings.customProfile).toBeUndefined();
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

  describe('custom profile persistence', () => {
    it('stores custom profile params in settings', () => {
      const params = { ...CUSTOM_DEFAULTS, on: 120, mirror: true };
      useSettingsStore.getState().setSettings({ customProfile: params });
      expect(useSettingsStore.getState().settings.customProfile).toEqual(params);
    });

    it('accepts CUSTOM as a selected profile', () => {
      useSettingsStore.getState().setSelectedProfile('CUSTOM');
      expect(useSettingsStore.getState().settings.selectedProfile).toBe('CUSTOM');
    });
  });
});
