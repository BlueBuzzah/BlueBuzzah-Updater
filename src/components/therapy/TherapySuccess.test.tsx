import { render, screen } from '@testing-library/react';
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

function renderWith(configs: DeviceConfigResult[], overallSuccess: boolean) {
  render(
    <TherapySuccess
      profile="CUSTOM"
      devices={configs.map((c) => c.device)}
      result={{
        success: overallSuccess,
        message: 'result message',
        deviceConfigs: configs,
      }}
      onReset={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe('TherapySuccess header counts', () => {
  beforeEach(() => {
    useTherapyStore.getState().reset();
  });

  // A partial is `success: true` by design — the profile change did land — so
  // counting only `!success` reported "0 of 2 devices failed" on a screen that
  // was simultaneously showing a Partial badge.
  it('counts a partial device distinctly rather than as a clean success', () => {
    renderWith(
      [
        config('/dev/cu.a', true, 'success'),
        config('/dev/cu.b', true, 'partial'),
      ],
      false
    );

    expect(screen.getByText(/1 of 2 devices finished only partially/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/0 of 2/)).not.toBeInTheDocument();
  });

  it('reports failures and partials together when both occurred', () => {
    renderWith(
      [
        config('/dev/cu.a', false),
        config('/dev/cu.b', true, 'partial'),
        config('/dev/cu.c', true, 'success'),
      ],
      false
    );

    const summary = screen.getByTestId('outcome-summary').textContent ?? '';
    expect(summary).toMatch(/1 of 3 devices failed/i);
    expect(summary).toMatch(/1 finished only partially/i);
  });

  it('keeps the plain failure wording when nothing was partial', () => {
    renderWith([config('/dev/cu.a', false), config('/dev/cu.b', false)], false);

    expect(
      screen.getByText(/all devices failed to configure/i)
    ).toBeInTheDocument();
  });

  it('does not count a secondary glove as a problem', () => {
    renderWith(
      [
        config('/dev/cu.a', true, 'success'),
        config('/dev/cu.b', true, 'success_secondary'),
      ],
      true
    );

    expect(screen.getByText(/configuration complete/i)).toBeInTheDocument();
    expect(
      screen.getByText(/all 2 devices have been configured successfully/i)
    ).toBeInTheDocument();
  });
});
