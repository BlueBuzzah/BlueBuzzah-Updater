import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockDevice } from '@/test/factories';
import type { DeviceUpdateResult } from '@/types';
import { FlashOutcome } from './FlashOutcome';

const primary = createMockDevice({ path: '/dev/cu.a', role: 'PRIMARY' });
const secondary = createMockDevice({ path: '/dev/cu.b', role: 'SECONDARY' });

function renderWith(results: DeviceUpdateResult[], error: string | null = null) {
  render(
    <FlashOutcome version="2.1.0" devices={results.map((r) => r.device)} results={results} error={error} logText="" />
  );
}

describe('FlashOutcome', () => {
  it('confirms a clean flash on both devices', () => {
    renderWith([
      { device: primary, success: true, warnings: [] },
      { device: secondary, success: true },
    ]);
    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('bb-banner--success');
    expect(banner).toHaveTextContent('Firmware 2.1.0 is on both devices');
    expect(banner).toHaveTextContent('they find each other on their own');
    expect(screen.getAllByText('Done', { selector: '.bb-badge span' })).toHaveLength(2);
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
  });

  it('warns when every device updated but one reported a problem', () => {
    const warning = '[WARN] Motor check: 2/5 motors responded - check JST connections';
    renderWith([
      { device: primary, success: true, warnings: [] },
      { device: secondary, success: true, warnings: [warning] },
    ]);
    const banner = screen.getByRole('status');
    expect(banner).toHaveClass('bb-banner--warning');
    expect(banner).toHaveTextContent('Firmware 2.1.0 is on both devices');
    expect(banner).toHaveTextContent('The secondary device reported a problem after the update. The details are below.');
    expect(banner).not.toHaveTextContent('find each other');
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText(`Secondary (/dev/cu.b): ${warning}`)).toBeInTheDocument();
    expect(screen.getByText('Warning', { selector: '.bb-badge span' })).toBeInTheDocument();
    expect(screen.getByText('Done', { selector: '.bb-badge span' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Secondary device.*Warning/ })).toBeInTheDocument();
  });

  it('says both devices reported a problem and lists every warning', () => {
    renderWith([
      { device: primary, success: true, warnings: ['[ERROR] DRV2605 finger 2 initialization failed'] },
      { device: secondary, success: true, warnings: ["The role wasn't set. Update this device again to set it."] },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Both devices reported a problem after the update.');
    expect(screen.getByText('Primary (/dev/cu.a): [ERROR] DRV2605 finger 2 initialization failed')).toBeInTheDocument();
    expect(screen.getByText("Secondary (/dev/cu.b): The role wasn't set. Update this device again to set it.")).toBeInTheDocument();
    expect(screen.getAllByText('Warning', { selector: '.bb-badge span' })).toHaveLength(2);
  });

  it('keeps the failure banner for a real failure and still marks the warned device', () => {
    renderWith([
      { device: primary, success: true, warnings: ['[ERROR] DRV2605 finger 2 initialization failed'] },
      { device: secondary, success: false, error: 'Device disconnected' },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent("1 of 2 devices didn't update");
    expect(screen.getByText('Warning', { selector: '.bb-badge span' })).toBeInTheDocument();
    expect(screen.getByText('Failed', { selector: '.bb-badge span' })).toBeInTheDocument();
    expect(screen.getByText('Primary (/dev/cu.a): [ERROR] DRV2605 finger 2 initialization failed')).toBeInTheDocument();
  });
});
