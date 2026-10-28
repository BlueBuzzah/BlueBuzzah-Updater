import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirmwarePage } from './FirmwarePage';
import { useWizardStore } from '@/stores/wizardStore';
import { createMockDevice, createMockRelease } from '@/test/factories';

vi.mock('@/components/wizard/DeviceSelection', () => ({ DeviceSelection: () => <div data-testid="device-selection" /> }));
vi.mock('@/components/wizard/FirmwareSelection', () => ({ FirmwareSelection: () => <div data-testid="firmware-selection" /> }));
vi.mock('@/components/wizard/InstallationProgress', () => ({ InstallationProgress: () => <div data-testid="installation-progress" /> }));

describe('FirmwarePage choose phase', () => {
  beforeEach(() => useWizardStore.getState().reset());

  it('shows devices and versions on one page', () => {
    render(<FirmwarePage />);
    expect(screen.getByTestId('device-selection')).toBeInTheDocument();
    expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
  });

  it('explains why Flash firmware is unavailable', () => {
    render(<FirmwarePage />);
    expect(screen.getByRole('button', { name: 'Flash firmware' })).toBeDisabled();
    expect(screen.getByText('Choose a device and a version first.')).toBeInTheDocument();
  });

  it('asks for roles before flashing', () => {
    useWizardStore.setState({ selectedRelease: createMockRelease(), selectedDevices: [createMockDevice({ role: undefined })] });
    render(<FirmwarePage />);
    expect(screen.getByText('Choose a role for each device first.')).toBeInTheDocument();
  });

  it('warns when an experimental version is chosen', () => {
    useWizardStore.setState({ selectedRelease: createMockRelease({ isPrerelease: true }) });
    render(<FirmwarePage />);
    expect(screen.getByText('This is an experimental version')).toBeInTheDocument();
  });

  it('starts one flash for a tremor double click', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    useWizardStore.setState({ selectedRelease: createMockRelease(), selectedDevices: [createMockDevice({ role: 'PRIMARY' })] });
    const setStep = vi.spyOn(useWizardStore.getState(), 'setStep');
    render(<FirmwarePage />);
    const btn = screen.getByRole('button', { name: 'Flash firmware' });
    fireEvent.click(btn);
    vi.setSystemTime(1100);
    fireEvent.click(btn);
    expect(setStep).toHaveBeenCalledTimes(1);
    expect(setStep).toHaveBeenCalledWith(2);
    vi.useRealTimers();
  });
});
