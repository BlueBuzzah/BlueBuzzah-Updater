import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceService } from '@/services/DeviceService';
import { useLogsStore } from '@/stores/logsStore';
import { createMockDevice } from '@/test/factories';
import type { Device, MonitorEvent } from '@/types';
import { LogsPage } from './LogsPage';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));
vi.mock('@/services/DeviceService', () => ({ deviceService: { detectDevices: vi.fn() } }));
vi.mock('@/components/wizard/DeviceSelection', () => ({
  BOARD_NAME: { nrf52: 'BlueBuzzah v2', esp32s3: 'BlueBuzzah v3' },
  DeviceSelection: ({ mode, onDevicesChange }: { mode: string; onDevicesChange: (d: Device[]) => void }) => (
    <div data-testid="device-selection" data-mode={mode}>
      <button onClick={() => onDevicesChange([a, b])}>Pick Both</button>
    </div>
  ),
}));

const a = createMockDevice({ path: '/dev/cu.a', serialNumber: 'A1', board: 'nrf52' });
const b = createMockDevice({ path: 'COM7', serialNumber: 'E1', board: 'esp32s3' });

type Emit = (event: MonitorEvent) => void;
/** The latest start_serial_monitor channel per port */
let channels: Map<string, Emit>;
let failPorts: Set<string>;

function mockBackend() {
  channels = new Map();
  failPorts = new Set();
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const { port, onEvent } = args as { port: string; onEvent?: { onmessage: Emit } };
    if (cmd === 'start_serial_monitor') {
      if (failPorts.has(port)) throw 'Port busy';
      channels.set(port, (e) => onEvent?.onmessage(e));
    }
    return undefined;
  });
}

const emit = (port: string, event: MonitorEvent) => act(() => channels.get(port)?.(event));
const lines = (...texts: string[]): MonitorEvent => ({ event: 'lines', data: { lines: texts.map((text, i) => ({ t: i, text })) } });
const pane = (name: RegExp) => screen.getByRole('region', { name });

async function startViewing() {
  const view = render(<LogsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Pick Both' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start Viewing' })));
  return view;
}

/** Stop Viewing renders in Start Viewing's place, so its 400ms repeat guard is still running: wait it out. */
async function stopViewing() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 1000);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop Viewing' })));
  vi.useRealTimers();
}

describe('LogsPage', () => {
  beforeEach(() => {
    useLogsStore.getState().reset();
    mockBackend();
  });

  it('chooses devices in monitor mode, with Start Viewing held until one is chosen', () => {
    render(<LogsPage />);
    expect(screen.getByTestId('device-selection')).toHaveAttribute('data-mode', 'monitor');
    expect(screen.getByRole('button', { name: 'Start Viewing' })).toBeDisabled();
    expect(screen.getByText('Choose 1 or 2 devices first.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Both' }));
    expect(screen.getByRole('button', { name: 'Start Viewing' })).toBeEnabled();
  });

  it('Start Viewing starts a monitor per device and shows its lines', async () => {
    await startViewing();
    expect(invoke).toHaveBeenCalledWith('start_serial_monitor', expect.objectContaining({ port: '/dev/cu.a' }));
    expect(invoke).toHaveBeenCalledWith('start_serial_monitor', expect.objectContaining({ port: 'COM7' }));
    expect(useLogsStore.getState().viewing).toBe(true);
    emit('/dev/cu.a', lines('[BOOT] BlueBuzzah', '[READY]'));
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText('[BOOT] BlueBuzzah')).toBeInTheDocument();
    expect(within(first).getByText('Connected')).toBeInTheDocument();
    expect(within(pane(/BlueBuzzah v3/)).queryByText('[READY]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show Log' })).toBeNull();
  });

  it('Pause Scrolling stops following while lines keep coming', async () => {
    await startViewing();
    const first = pane(/BlueBuzzah v2/);
    fireEvent.click(within(first).getByRole('button', { name: 'Pause Scrolling' }));
    expect(useLogsStore.getState().panes.A1.follow).toBe(false);
    emit('/dev/cu.a', lines('still here'));
    expect(within(first).getByText('still here')).toBeInTheDocument();
    fireEvent.click(within(first).getByRole('button', { name: 'Resume Scrolling' }));
    expect(useLogsStore.getState().panes.A1.follow).toBe(true);
  });

  it('a disconnect adds a marker, flips the badge and offers Reconnect, keeping the log', async () => {
    await startViewing();
    emit('/dev/cu.a', lines('before'));
    emit('/dev/cu.a', { event: 'disconnected', data: { reason: 'Device not configured' } });
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText('before')).toBeInTheDocument();
    expect(within(first).getByText('--- Disconnected ---')).toBeInTheDocument();
    expect(within(first).getByText('Disconnected')).toBeInTheDocument();
    expect(within(first).getByText('Plug the device back in, then select Reconnect.')).toHaveAttribute('aria-live', 'polite');
    expect(within(first).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(within(pane(/BlueBuzzah v3/)).queryByRole('button', { name: 'Reconnect' })).toBeNull();
    for (const list of screen.getAllByRole('list')) expect(list.closest('[aria-live]')).toBeNull();
  });

  it('Reconnect finds the device by serial number on a new port and resumes there', async () => {
    await startViewing();
    emit('/dev/cu.a', { event: 'disconnected', data: { reason: 'gone' } });
    vi.mocked(deviceService.detectDevices).mockResolvedValue([
      createMockDevice({ path: '/dev/cu.boot', serialNumber: 'A1', inBootloader: true }),
      createMockDevice({ path: '/dev/cu.new', serialNumber: 'A1', board: 'nrf52' }),
    ]);
    await act(async () => fireEvent.click(within(pane(/BlueBuzzah v2/)).getByRole('button', { name: 'Reconnect' })));
    expect(invoke).toHaveBeenLastCalledWith('start_serial_monitor', expect.objectContaining({ port: '/dev/cu.new' }));
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText('/dev/cu.new')).toBeInTheDocument();
    expect(within(first).getByText('--- Reconnected ---')).toBeInTheDocument();
    expect(within(first).getByText('Connected')).toBeInTheDocument();
    expect(within(first).queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(within(first).queryByText('Plug the device back in, then select Reconnect.')).toBeNull();
    emit('/dev/cu.new', lines('after'));
    expect(within(first).getByText('after')).toBeInTheDocument();
  });

  it('Reconnect says when the device is not found', async () => {
    await startViewing();
    emit('/dev/cu.a', { event: 'disconnected', data: { reason: 'gone' } });
    vi.mocked(deviceService.detectDevices).mockResolvedValue([createMockDevice({ path: '/dev/cu.other', serialNumber: 'Z9' })]);
    await act(async () => fireEvent.click(within(pane(/BlueBuzzah v2/)).getByRole('button', { name: 'Reconnect' })));
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText("Device not found. Check it's plugged in and turned on, then try again.")).toBeInTheDocument();
    expect(within(first).getByText('Disconnected')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2); // only the two first starts
  });

  it('a device that fails to start shows Disconnected and Reconnect while the other streams', async () => {
    failPorts.add('COM7');
    await startViewing();
    const second = pane(/BlueBuzzah v3/);
    expect(within(second).getByText('Disconnected')).toBeInTheDocument();
    expect(within(second).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(within(second).getByText('Plug the device back in, then select Reconnect.')).toBeInTheDocument();
    expect(within(second).queryByText('--- Disconnected ---')).toBeNull();
    emit('/dev/cu.a', lines('streaming'));
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText('streaming')).toBeInTheDocument();
    expect(within(first).getByText('Connected')).toBeInTheDocument();
  });

  it('Stop Viewing stops every monitor and returns to the choice, keeping the logs', async () => {
    await startViewing();
    emit('/dev/cu.a', lines('kept'));
    await stopViewing();
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: '/dev/cu.a' });
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: 'COM7' });
    expect(screen.getByTestId('device-selection')).toBeInTheDocument();
    expect(useLogsStore.getState().viewing).toBe(false);
    expect(useLogsStore.getState().panes.A1.lines).toEqual(['kept']);
    // A late event from the stopped run is ignored.
    emit('/dev/cu.a', lines('late'));
    expect(useLogsStore.getState().panes.A1.lines).toEqual(['kept']);
  });

  it('stops every monitor if the page unmounts while viewing', async () => {
    const { unmount } = await startViewing();
    unmount();
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: '/dev/cu.a' });
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: 'COM7' });
    expect(useLogsStore.getState().viewing).toBe(false);
  });
});
