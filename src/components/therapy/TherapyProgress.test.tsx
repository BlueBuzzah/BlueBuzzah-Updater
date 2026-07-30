import { render, screen, waitFor } from '@testing-library/react';
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

  // The firmware echoes its whole serial stream back inside a timeout message.
  // The card must stay readable; the raw text has to survive somewhere the user
  // can copy it afterwards.
  it('shows a short summary on the card and keeps the full text in the log', async () => {
    const noisy =
      'Timeout waiting for menu response to PROFILE_LOAD:4. Received: [BLE] UART service discovered\n [STATUS] Role: SECONDARY | State: READY';
    mockConfigure.mockRejectedValue(noisy);
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

    // Card: the concise line only — the echoed device chatter must not be
    // rendered as the device's status text.
    const cardStatus = screen.getByText(
      'Timeout waiting for menu response to PROFILE_LOAD:4.'
    );
    expect(cardStatus.textContent).not.toContain('[BLE]');
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(
      screen.getByText('Full device output is in the configuration log below.')
    ).toBeInTheDocument();

    // Log: the raw text, retained for copying.
    const logged = useTherapyStore.getState().logs.join('\n');
    expect(logged).toContain('[BLE] UART service discovered');
    expect(logged).toContain('Role: SECONDARY');
  });

  it('keeps a partial outcome detail out of the card and in the log', async () => {
    mockConfigure.mockResolvedValue({
      status: 'partial',
      message: 'Profile loaded, but the glove never came back to confirm the parameters.',
      detail:
        'Timeout waiting for menu response to INFO. Received: [DIAG] silk port 3 (F2): MOTOR PRESENT (STATUS=0xE4)',
    });
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

    const logged = useTherapyStore.getState().logs.join('\n');
    expect(logged).toContain('MOTOR PRESENT (STATUS=0xE4)');
    expect(
      onComplete.mock.calls[0][0].deviceConfigs[0].outcome.message
    ).not.toContain('[DIAG]');
  });

  // The progress screen must not claim success for a partial. A partial means
  // the profile changed but the parameters did not - the glove is running its
  // previous override - so a "Configured" badge there is an explicit false
  // success claim on the very screen the safety design exists to protect.
  it('marks a partial device as partial, not configured, on the progress card', async () => {
    mockConfigure.mockImplementation(async (_device, _profile, onProgress) => {
      onProgress?.({
        devicePath: '/dev/cu.a',
        stage: 'partial',
        progress: 100,
        message: 'Profile loaded, but the parameters could not be confirmed.',
      });
      return {
        status: 'partial' as const,
        message: 'Profile loaded, but the parameters could not be confirmed.',
      };
    });
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

    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.queryByText('Configured')).not.toBeInTheDocument();
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
