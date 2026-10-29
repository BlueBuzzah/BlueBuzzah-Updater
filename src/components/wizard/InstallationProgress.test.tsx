import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { InstallationProgress } from './InstallationProgress';
import { firmwareService } from '@/services/FirmwareService';
import { deviceService } from '@/services/DeviceService';
import { createMockRelease, createMockDevice, createMockBundle } from '@/test/factories';
import type { UpdateProgress } from '@/types';
import { getErrorGuidance } from '@/lib/error-messages';

vi.mock('@/services/FirmwareService', () => ({ firmwareService: { downloadFirmware: vi.fn() } }));
vi.mock('@/services/DeviceService', () => ({
  deviceService: { validateDevices: vi.fn(), deployFirmware: vi.fn(), cancelFlash: vi.fn() },
}));

const store = { reset: vi.fn(), updateDeviceInfo: vi.fn(), addLog: vi.fn(), setUpdateResult: vi.fn(), logs: [] as string[] };
vi.mock('@/stores/wizardStore', () => ({ useWizardStore: () => store }));

const release = createMockRelease({ version: '2.0.4' });
const primary = createMockDevice({ path: '/dev/cu.a', role: 'PRIMARY' });
const secondary = createMockDevice({ path: '/dev/cu.b', role: 'SECONDARY', serialNumber: 'B2' });
const valid = (paths: string[]) => new Map(paths.map((p) => [p, { valid: true, errors: [], warnings: [] }]));

function renderIt(devices = [primary], onComplete = vi.fn(), onProgressUpdate = vi.fn()) {
  render(<InstallationProgress release={release} devices={devices} onComplete={onComplete} onProgressUpdate={onProgressUpdate} />);
  return { onComplete, onProgressUpdate };
}

describe('InstallationProgress', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(deviceService.cancelFlash).mockResolvedValue(undefined);
    store.logs = [];
  });

  it('warns to keep the device plugged in and shows the step with its percentage', async () => {
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([primary.path]));
    vi.mocked(firmwareService.downloadFirmware).mockImplementation(() => new Promise(() => {}));
    renderIt();
    expect(screen.getByRole('status')).toHaveTextContent('Keep the device plugged in until this finishes.');
    expect(await screen.findByText('Downloading firmware — 0%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Overall progress' })).toBeInTheDocument();
  });

  it('uses the plural warning for two devices', () => {
    vi.mocked(deviceService.validateDevices).mockImplementation(() => new Promise(() => {}));
    renderIt([primary, secondary]);
    expect(screen.getByRole('status')).toHaveTextContent('Keep the devices plugged in until this finishes.');
  });

  it('shows each device with a word for its state and its own percentage', async () => {
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([primary.path]));
    vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(createMockBundle());
    vi.mocked(deviceService.deployFirmware).mockImplementation(async (_d, _f, onProgress) => {
      onProgress!({ devicePath: primary.path, stage: 'copying', progress: 64, message: 'Writing' } as UpdateProgress);
      return new Promise(() => {});
    });
    renderIt();
    expect(await screen.findByRole('group', { name: /Primary device.*Flashing/ })).toBeInTheDocument();
    expect(screen.getByText('Flashing').closest('.bb-badge')!.querySelector('svg')).toHaveClass('lucide-clock');
    expect(screen.getByRole('progressbar', { name: 'Primary device' })).toHaveAttribute('aria-valuenow', '64');
  });

  it('downloads the firmware for the devices’ board and reports success', async () => {
    const v3 = createMockDevice({ path: 'COM7', board: 'esp32s3', role: 'PRIMARY' });
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([v3.path]));
    vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(createMockBundle());
    vi.mocked(deviceService.deployFirmware).mockResolvedValue(undefined as never);
    const { onComplete } = renderIt([v3]);
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ success: true })));
    expect(firmwareService.downloadFirmware).toHaveBeenCalledWith(release, 'esp32s3');
  });

  it('refuses a mixed v2/v3 batch before downloading', async () => {
    const v3 = createMockDevice({ path: 'COM7', board: 'esp32s3', role: 'SECONDARY' });
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([primary.path, v3.path]));
    const { onComplete } = renderIt([primary, v3]);
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ success: false })));
    expect(firmwareService.downloadFirmware).not.toHaveBeenCalled();
  });

  it('shows a failure as a danger banner with steps, the detail underneath and Copy Details', async () => {
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([primary.path]));
    vi.mocked(firmwareService.downloadFirmware).mockRejectedValue(new Error('network error: connection refused'));
    const { onComplete } = renderIt();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(getErrorGuidance('network error: connection refused')!.title);
    expect(screen.getByRole('button', { name: 'Copy Details' })).toBeInTheDocument();
    expect(screen.getByText('network error: connection refused')).toHaveClass('code-s');
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('keeps the full log viewable, copyable and savable when a device fails', async () => {
    store.logs = ['[12:00:00] ERROR Error updating Secondary: Failed to configure device role'];
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([primary.path, secondary.path]));
    vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(createMockBundle());
    vi.mocked(deviceService.deployFirmware)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Failed to configure device role: timeout'));
    renderIt([primary, secondary]);
    await screen.findByText("1 of 2 devices didn't update");
    fireEvent.click(screen.getByRole('button', { name: 'Show Log' }));
    expect(screen.getByText(store.logs[0])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy Log' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Log' })).toBeInTheDocument();
  });

  it('a tremor double click on Try Again starts one retry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([primary.path]));
    vi.mocked(firmwareService.downloadFirmware).mockRejectedValueOnce(new Error('boom')).mockImplementation(() => new Promise(() => {}));
    renderIt();
    const retry = await screen.findByRole('button', { name: 'Try Again' });
    expect(screen.getByTestId('action-bar')).toContainElement(retry);
    expect(screen.getByTestId('action-bar')).toContainElement(screen.getByRole('button', { name: 'Start Over' }));
    fireEvent.click(retry);
    vi.setSystemTime(1100);
    fireEvent.click(retry);
    await waitFor(() => expect(firmwareService.downloadFirmware).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it('confirms before stopping, without double-tap recovery advice', async () => {
    vi.mocked(deviceService.validateDevices).mockImplementation(() => new Promise(() => {}));
    renderIt();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toHaveClass('bb-btn--danger');
    // Same row as Show Log, at the end.
    expect(stop.parentElement).toBe(screen.getByRole('button', { name: 'Show Log' }).parentElement);
    expect(stop.parentElement!.lastElementChild).toBe(stop);
    expect(screen.queryByTestId('action-bar')).not.toBeInTheDocument();
    fireEvent.click(stop);
    const dialog = screen.getByRole('alertdialog', { name: 'Stop the Flash?' });
    expect(dialog).not.toHaveTextContent(/twice/i);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Flash' }));
    await waitFor(() => expect(deviceService.cancelFlash).toHaveBeenCalled());
  });

  it('writes log lines that start with a level word', async () => {
    vi.mocked(deviceService.validateDevices).mockResolvedValue(
      new Map([[primary.path, { valid: false, errors: ['port busy'], warnings: [] }]])
    );
    renderIt();
    await screen.findByRole('alert');
    const lines = store.addLog.mock.calls.map(([l]) => l as string);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((l) => expect(l).toMatch(/^(INFO|WARN|ERROR) {2}/));
    expect(lines.some((l) => l.startsWith('ERROR  '))).toBe(true);
  });

  it('tracks a renamed device without mutating the original object', async () => {
    const original = { ...primary };
    vi.mocked(deviceService.validateDevices).mockResolvedValue(valid([primary.path]));
    vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(createMockBundle());
    vi.mocked(deviceService.deployFirmware).mockImplementation(async (_d, _f, onProgress) => {
      onProgress!({ devicePath: primary.path, stage: 'configuring', progress: 90, message: '', newDevicePath: '/dev/cu.z', newDeviceLabel: 'Z' } as UpdateProgress);
    });
    const { onComplete } = renderIt([primary]);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(primary).toEqual(original);
    expect(store.updateDeviceInfo).toHaveBeenCalledWith('/dev/cu.a', 'Z', '/dev/cu.z');
  });

  it('cancels the flash on unmount', async () => {
    vi.mocked(deviceService.validateDevices).mockImplementation(() => new Promise(() => {}));
    let unmount: () => void = () => {};
    act(() => {
      ({ unmount } = render(<InstallationProgress release={release} devices={[primary]} onComplete={vi.fn()} onProgressUpdate={vi.fn()} />));
    });
    unmount();
    expect(deviceService.cancelFlash).toHaveBeenCalled();
  });
});
