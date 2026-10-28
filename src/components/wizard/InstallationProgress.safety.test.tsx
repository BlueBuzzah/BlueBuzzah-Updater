import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallationProgress } from './InstallationProgress';
import { firmwareService } from '@/services/FirmwareService';
import { deviceService } from '@/services/DeviceService';
import { useWizardStore } from '@/stores/wizardStore';
import { useIsBusy } from '@/stores/busy';
import { createMockBundle, createMockDevice, createMockRelease } from '@/test/factories';

vi.mock('@/services/FirmwareService', () => ({ firmwareService: { downloadFirmware: vi.fn() } }));
vi.mock('@/services/DeviceService', () => ({
  deviceService: { validateDevices: vi.fn(), deployFirmware: vi.fn(), cancelFlash: vi.fn() },
}));

const release = createMockRelease({ version: '2.0.4' });
const device = createMockDevice({ path: '/dev/cu.a', role: 'PRIMARY' });

/** Wires InstallationProgress to the real store the way FirmwarePage does, and shows the busy flag. */
function Harness() {
  const { busy } = useIsBusy();
  const setUpdateResult = useWizardStore((s) => s.setUpdateResult);
  return (
    <>
      <p data-testid="busy">{String(busy)}</p>
      <InstallationProgress release={release} devices={[device]} onComplete={setUpdateResult} onProgressUpdate={vi.fn()} />
    </>
  );
}

describe('flash run safety', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(deviceService.cancelFlash).mockResolvedValue(undefined);
    vi.mocked(deviceService.validateDevices).mockResolvedValue(new Map([[device.path, { valid: true, errors: [], warnings: [] }]]));
    useWizardStore.getState().reset();
    useWizardStore.setState({ currentStep: 2, selectedRelease: release, selectedDevices: [device] });
  });

  it('keeps every run guard on while a retried flash runs', async () => {
    vi.mocked(firmwareService.downloadFirmware).mockRejectedValueOnce(new Error('boom')).mockImplementation(() => new Promise(() => {}));
    render(<Harness />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByTestId('busy')).toHaveTextContent('false');
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId('busy')).toHaveTextContent('true'));
  });

  it('ends the run after Stop, unlocks the app and offers Start over', async () => {
    vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(createMockBundle());
    vi.mocked(deviceService.deployFirmware).mockImplementation(() => new Promise(() => {}));
    render(<Harness />);
    await waitFor(() => expect(deviceService.deployFirmware).toHaveBeenCalled());
    expect(screen.getByTestId('busy')).toHaveTextContent('true');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop flash' }));
    });
    await waitFor(() => expect(screen.getByTestId('busy')).toHaveTextContent('false'));
    expect(screen.getByRole('alert')).toHaveTextContent('Flash stopped');
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
    expect(deviceService.cancelFlash).toHaveBeenCalled();
  });
});
