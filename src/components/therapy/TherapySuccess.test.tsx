import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDevice } from '@/test/factories';
import { useTherapyStore } from '@/stores/therapyStore';
import type { DeviceConfigResult, ProfileConfigStatus } from '@/types';
import { TherapySuccess } from './TherapySuccess';

function config(
  path: string,
  success: boolean,
  status?: ProfileConfigStatus
): DeviceConfigResult {
  const device = createMockDevice({ path, label: `Glove ${path}` });
  return {
    device,
    success,
    outcome: status ? { status, message: `${status} message` } : undefined,
    error: success ? undefined : 'Device not found',
  };
}

function renderWith(configs: DeviceConfigResult[], overallSuccess: boolean, profile: 'CUSTOM' | 'REGULAR' = 'CUSTOM') {
  render(
    <TherapySuccess
      profile={profile}
      devices={configs.map((c) => c.device)}
      result={{
        success: overallSuccess,
        message: 'result message',
        deviceConfigs: configs,
      }}
      onClose={vi.fn()}
    />
  );
}

describe('TherapySuccess', () => {
  beforeEach(() => useTherapyStore.getState().reset());

  it('confirms the pattern on both devices', () => {
    renderWith([config('a', true, 'success'), config('b', true, 'success')], true, 'REGULAR');
    expect(screen.getByRole('status')).toHaveTextContent('Regular is set on both devices');
    expect(screen.getAllByText('Done', { selector: '.bb-badge span' })).toHaveLength(2);
  });

  it('says custom settings were not applied when no device answered as Primary', () => {
    renderWith([config('a', true, 'success_secondary'), config('b', true, 'success_secondary')], true);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent("Custom settings weren't applied");
    expect(banner).toHaveTextContent('No device answered as the Primary device.');
    expect(document.body).not.toHaveTextContent('is set on');
  });

  it('warns about a partial result and names the device state', () => {
    renderWith([config('a', true, 'partial'), config('b', true, 'success')], false);
    expect(screen.getByRole('status')).toHaveTextContent('The pattern changed, but your custom settings may not have saved');
    expect(screen.getByText('Partly done', { selector: '.bb-badge span' })).toBeInTheDocument();
  });

  it('reports failures as a danger banner with Copy Details', () => {
    renderWith([config('a', false), config('b', true, 'success')], false);
    expect(screen.getByRole('alert')).toHaveTextContent("Setup didn't finish on 1 of 2 devices");
    expect(screen.getByRole('button', { name: 'Copy Details' })).toBeInTheDocument();
    expect(screen.getByText('Failed', { selector: '.bb-badge span' })).toBeInTheDocument();
  });

  it('offers only Done, in the action bar', () => {
    const onClose = vi.fn();
    render(
      <TherapySuccess
        profile="REGULAR"
        devices={[createMockDevice()]}
        result={{ success: true, message: '', deviceConfigs: [config('a', true, 'success')] }}
        onClose={onClose}
      />
    );
    expect(screen.queryByRole('button', { name: 'Set Up Another Device' })).not.toBeInTheDocument();
    const done = screen.getByRole('button', { name: /^Done$/ });
    expect(screen.getByTestId('action-bar')).toContainElement(done);
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalled();
  });
});
