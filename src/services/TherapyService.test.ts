import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_DEFAULTS } from '@/lib/therapy-bounds';
import { therapyService } from './TherapyService';
import { createMockDevice } from '@/test/factories';
import { useSettingsStore } from '@/stores/settingsStore';

// Channel isn't overridden with the real implementation here: it calls into
// window.__TAURI_INTERNALS__.transformCallback, which only exists inside an
// actual Tauri webview. Stub it the same way src/test/setup.ts does globally.
vi.mock('@tauri-apps/api/core', async () => {
  const actual = await vi.importActual<typeof import('@tauri-apps/api/core')>(
    '@tauri-apps/api/core'
  );
  class MockChannel<T = unknown> {
    onmessage: ((message: T) => void) | null = null;
  }
  return { ...actual, invoke: vi.fn(), Channel: MockChannel };
});

const mockInvoke = vi.mocked(invoke);

describe('TherapyService.readCustomProfile', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('returns the backend read result', async () => {
    const read = {
      case: 'custom',
      values: CUSTOM_DEFAULTS,
      profileName: 'custom_vcr',
      motors: 4,
    };
    mockInvoke.mockResolvedValue(read);

    await expect(therapyService.readCustomProfile()).resolves.toEqual(read);
    expect(mockInvoke).toHaveBeenCalledWith('read_custom_profile');
  });
});

describe('TherapyService.configureProfile', () => {
  beforeEach(() => mockInvoke.mockReset());

  it('returns the backend outcome', async () => {
    const outcome = { status: 'partial', message: 'could not be confirmed', warnings: [] };
    mockInvoke.mockResolvedValue(outcome);

    const result = await therapyService.configureProfile(
      createMockDevice(),
      'CUSTOM'
    );

    expect(result).toEqual(outcome);
  });

  it('sends the defaults for Custom when no Custom profile is saved', async () => {
    mockInvoke.mockResolvedValue({ status: 'success', message: 'ok', warnings: [] });
    const { customProfile: _, ...settings } = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings });

    await therapyService.configureProfile(createMockDevice(), 'CUSTOM');

    expect(mockInvoke).toHaveBeenCalledWith(
      'set_device_profile',
      expect.objectContaining({
        advancedSettings: expect.objectContaining({ customProfile: CUSTOM_DEFAULTS }),
      })
    );
  });
});
