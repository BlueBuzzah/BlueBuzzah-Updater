import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDevice } from '@/test/factories';
import { therapyService } from '@/services/TherapyService';
import { useTherapyStore } from '@/stores/therapyStore';
import { TherapyProgress } from './TherapyProgress';

vi.mock('@/services/TherapyService', () => ({
  therapyService: { configureProfile: vi.fn(), readCustomProfile: vi.fn() },
}));

const mockConfigure = vi.mocked(therapyService.configureProfile);

function device(path: string, label: string) {
  return createMockDevice({ path, label });
}

describe('TherapyProgress outcome reporting', () => {
  beforeEach(() => {
    mockConfigure.mockReset();
    useTherapyStore.getState().reset();
  });

  // Tauri rejects an `invoke` with a plain string, not an Error, so an
  // `instanceof Error` guard silently swallows every backend message and
  // reports a generic failure instead. That is how a v3 glove's "Device not
  // found" surfaced to a user as an unexplained "Configuration failed".
  it('reports the backend message when the rejection is a bare string', async () => {
    mockConfigure.mockRejectedValue('Device not found');
    const onComplete = vi.fn();

    render(
      <TherapyProgress
        profile="CUSTOM"
        devices={[device('/dev/cu.a', 'Glove A')]}
        onComplete={onComplete}
        onProgressUpdate={vi.fn()}
      />
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].deviceConfigs[0].error).toBe(
      'Device not found'
    );
  });

  it('still reports the message when the rejection is a real Error', async () => {
    mockConfigure.mockRejectedValue(new Error('Serial port busy'));
    const onComplete = vi.fn();

    render(
      <TherapyProgress
        profile="CUSTOM"
        devices={[device('/dev/cu.a', 'Glove A')]}
        onComplete={onComplete}
        onProgressUpdate={vi.fn()}
      />
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].deviceConfigs[0].error).toBe(
      'Serial port busy'
    );
  });

  it('carries the backend outcome into the per-device result', async () => {
    const outcome = { status: 'partial' as const, message: 'not confirmed' };
    mockConfigure.mockResolvedValue(outcome);
    const onComplete = vi.fn();

    render(
      <TherapyProgress
        profile="CUSTOM"
        devices={[device('/dev/cu.a', 'Glove A')]}
        onComplete={onComplete}
        onProgressUpdate={vi.fn()}
      />
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const result = onComplete.mock.calls[0][0];
    expect(result.deviceConfigs[0].outcome).toEqual(outcome);
    expect(result.deviceConfigs[0].success).toBe(true);
  });

  it('does not report overall success when any device is partial', async () => {
    mockConfigure
      .mockResolvedValueOnce({ status: 'success', message: 'ok' })
      .mockResolvedValueOnce({ status: 'partial', message: 'not confirmed' });
    const onComplete = vi.fn();

    render(
      <TherapyProgress
        profile="CUSTOM"
        devices={[device('/dev/cu.a', 'Glove A'), device('/dev/cu.b', 'Glove B')]}
        onComplete={onComplete}
        onProgressUpdate={vi.fn()}
      />
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].success).toBe(false);
  });

  it('reports overall success when a device answers secondary', async () => {
    mockConfigure.mockResolvedValue({
      status: 'success_secondary',
      message: 'parameters apply to the primary glove',
    });
    const onComplete = vi.fn();

    render(
      <TherapyProgress
        profile="CUSTOM"
        devices={[device('/dev/cu.b', 'Glove B')]}
        onComplete={onComplete}
        onProgressUpdate={vi.fn()}
      />
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].success).toBe(true);
  });

  it('states that parameters were not applied when no device answered primary', async () => {
    mockConfigure.mockResolvedValue({
      status: 'success_secondary',
      message: 'parameters apply to the primary glove',
    });
    const onComplete = vi.fn();

    render(
      <TherapyProgress
        profile="CUSTOM"
        devices={[device('/dev/cu.a', 'Glove A'), device('/dev/cu.b', 'Glove B')]}
        onComplete={onComplete}
        onProgressUpdate={vi.fn()}
      />
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].message).toMatch(/not applied/i);
  });
});
