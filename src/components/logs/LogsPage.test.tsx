import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import type { Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceService } from '@/services/DeviceService';
import { useIsBusy } from '@/stores/busy';
import { useLogsStore } from '@/stores/logsStore';
import { createMockDevice } from '@/test/factories';
import type { Device, MonitorEvent } from '@/types';
import { LogsPage } from './LogsPage';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));
vi.mock('@/services/DeviceService', () => ({ deviceService: { detectDevices: vi.fn() } }));
vi.mock('@/components/wizard/DeviceSelection', () => ({
  BOARD_NAME: { nrf52: 'BlueBuzzah v2', esp32s3: 'BlueBuzzah v3' },
  DeviceSelection: ({ mode, onDevicesChange, titleRef }: { mode: string; onDevicesChange: (d: Device[]) => void; titleRef?: Ref<HTMLHeadingElement> }) => (
    <div data-testid="device-selection" data-mode={mode}>
      <h3 ref={titleRef} tabIndex={-1}>Choose Devices</h3>
      <button onClick={() => onDevicesChange([a, b])}>Pick Both</button>
    </div>
  ),
}));

const a = createMockDevice({ path: '/dev/cu.a', serialNumber: 'A1', board: 'nrf52' });
const b = createMockDevice({ path: 'COM7', serialNumber: 'E1', board: 'esp32s3' });

const UNPLUGGED = 'Plug the device back in, then select Reconnect.';
const OPEN_FAILED = "Couldn't open the device. Close any other app using it, then select Reconnect.";

type Emit = (event: MonitorEvent) => void;
/** The latest start_serial_monitor channel per port */
let channels: Map<string, Emit>;
let failPorts: Set<string>;
/** start_serial_monitor waits on these before resolving */
let holdStart: Map<string, Promise<void>>;
/** stop_serial_monitor waits on this before resolving */
let holdStop: Promise<void> | null;
/** Sent on the channel before start_serial_monitor resolves */
let early: Map<string, MonitorEvent>;

function mockBackend() {
  channels = new Map();
  failPorts = new Set();
  holdStart = new Map();
  holdStop = null;
  early = new Map();
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const { port, onEvent } = args as { port: string; onEvent?: { onmessage: Emit } };
    if (cmd === 'start_serial_monitor') {
      if (failPorts.has(port)) throw 'Port busy';
      channels.set(port, (e) => onEvent?.onmessage(e));
      const first = early.get(port);
      if (first) onEvent?.onmessage(first);
      await holdStart.get(port);
    }
    if (cmd === 'stop_serial_monitor') await holdStop;
    return undefined;
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const emit = (port: string, event: MonitorEvent) => act(() => channels.get(port)?.(event));
const lines = (...texts: string[]): MonitorEvent => ({ event: 'lines', data: { lines: texts.map((text, i) => ({ t: i, text })) } });
const pane = (name: RegExp) => screen.getByRole('region', { name });
const stopCalls = (port: string) => vi.mocked(invoke).mock.calls.filter(([cmd, args]) => cmd === 'stop_serial_monitor' && (args as { port: string }).port === port).length;

/**
 * Start Viewing, Stop Viewing and Done share one Button, whose 400ms repeat guard is
 * still running from the last press: step the clock past it. afterEach restores it.
 */
async function press(name: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 1000);
  await act(async () => fireEvent.click(screen.getByRole('button', { name })));
}

async function startViewing() {
  const view = render(<LogsPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Pick Both' }));
  await press('Start Viewing');
  return view;
}

describe('LogsPage', () => {
  beforeEach(() => {
    useLogsStore.getState().reset();
    mockBackend();
  });
  afterEach(() => vi.useRealTimers());

  it('chooses devices in monitor mode, with Start Viewing held until one is chosen', () => {
    render(<LogsPage />);
    expect(screen.getByTestId('device-selection')).toHaveAttribute('data-mode', 'monitor');
    expect(screen.getByRole('button', { name: 'Start Viewing' })).toBeDisabled();
    expect(screen.getByText('Choose 1 or 2 devices first.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pick Both' }));
    expect(screen.getByRole('button', { name: 'Start Viewing' })).toBeEnabled();
  });

  it('Start Viewing starts a monitor per device, shows its lines and focuses the first pane', async () => {
    await startViewing();
    expect(invoke).toHaveBeenCalledWith('start_serial_monitor', expect.objectContaining({ port: '/dev/cu.a' }));
    expect(invoke).toHaveBeenCalledWith('start_serial_monitor', expect.objectContaining({ port: 'COM7' }));
    expect(useLogsStore.getState().phase).toBe('streaming');
    emit('/dev/cu.a', lines('[BOOT] BlueBuzzah', '[READY]'));
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByRole('heading')).toHaveFocus();
    expect(within(first).getByText('[BOOT] BlueBuzzah')).toBeInTheDocument();
    expect(within(first).getByText('Connected').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(within(pane(/BlueBuzzah v3/)).queryByText('[READY]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show Log' })).toBeNull();
    expect(within(first).getByRole('list', { name: 'BlueBuzzah v2 /dev/cu.a log' })).toHaveAttribute('tabindex', '0');
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
    const badge = within(first).getByText('Disconnected').closest('[aria-live]');
    expect(badge).toHaveAttribute('aria-live', 'polite');
    expect(badge).toHaveTextContent('BlueBuzzah v2 /dev/cu.a: Disconnected');
    const note = within(first).getByText(UNPLUGGED).closest('[aria-live]');
    expect(note).toHaveAttribute('aria-live', 'polite');
    expect(note).toHaveTextContent(`BlueBuzzah v2 /dev/cu.a: ${UNPLUGGED}`);
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
    expect(within(first).queryByText(UNPLUGGED)).toBeNull();
    emit('/dev/cu.new', lines('after'));
    expect(within(first).getByText('after')).toBeInTheDocument();
  });

  it('Reconnect puts its marker before lines that arrive before the monitor opens', async () => {
    await startViewing();
    emit('/dev/cu.a', lines('before'));
    emit('/dev/cu.a', { event: 'disconnected', data: { reason: 'gone' } });
    vi.mocked(deviceService.detectDevices).mockResolvedValue([createMockDevice({ path: '/dev/cu.new', serialNumber: 'A1', board: 'nrf52' })]);
    early.set('/dev/cu.new', lines('early'));
    await act(async () => fireEvent.click(within(pane(/BlueBuzzah v2/)).getByRole('button', { name: 'Reconnect' })));
    expect(useLogsStore.getState().panes.A1.lines).toEqual(['before', '--- Disconnected ---', '--- Reconnected ---', 'early']);
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

  it('a device that fails to open says so and offers Reconnect while the other streams', async () => {
    failPorts.add('COM7');
    await startViewing();
    const second = pane(/BlueBuzzah v3/);
    expect(within(second).getByText('Disconnected')).toBeInTheDocument();
    expect(within(second).getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(within(second).getByText(OPEN_FAILED)).toBeInTheDocument();
    expect(within(second).queryByText('--- Disconnected ---')).toBeNull();
    emit('/dev/cu.a', lines('streaming'));
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText('streaming')).toBeInTheDocument();
    expect(within(first).getByText('Connected')).toBeInTheDocument();
  });

  it('a Reconnect that fails to open says so', async () => {
    await startViewing();
    emit('/dev/cu.a', { event: 'disconnected', data: { reason: 'gone' } });
    vi.mocked(deviceService.detectDevices).mockResolvedValue([createMockDevice({ path: '/dev/cu.new', serialNumber: 'A1', board: 'nrf52' })]);
    failPorts.add('/dev/cu.new');
    await act(async () => fireEvent.click(within(pane(/BlueBuzzah v2/)).getByRole('button', { name: 'Reconnect' })));
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText(OPEN_FAILED)).toBeInTheDocument();
    expect(within(first).getByText('Disconnected')).toBeInTheDocument();
  });

  it('Stop Viewing stops every monitor and keeps the logs on screen, with navigation unlocked', async () => {
    await startViewing();
    emit('/dev/cu.a', lines('kept'));
    await press('Stop Viewing');
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: '/dev/cu.a' });
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: 'COM7' });
    expect(useLogsStore.getState().phase).toBe('stopped');
    expect(renderHook(() => useIsBusy()).result.current).toEqual({ busy: false, kind: null });
    const first = pane(/BlueBuzzah v2/);
    expect(within(first).getByText('kept')).toBeInTheDocument();
    expect(within(first).getByText('Stopped')).toBeInTheDocument();
    expect(within(pane(/BlueBuzzah v3/)).getByText('Stopped')).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Copy Log' })).toBeInTheDocument();
    expect(within(first).getByRole('button', { name: 'Save Log' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scrolling/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(screen.getByText('Logs are cleared when you leave this screen. Copy or save them first.')).toBeInTheDocument();
    // A late event from the stopped run is ignored.
    emit('/dev/cu.a', lines('late'));
    expect(useLogsStore.getState().panes.A1.lines).toEqual(['kept']);
  });

  it('Done drops the logs and returns to Choose Devices with the selection kept', async () => {
    await startViewing();
    emit('/dev/cu.a', lines('gone'));
    await press('Stop Viewing');
    await press('Done');
    expect(screen.getByTestId('device-selection')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose Devices' })).toHaveFocus();
    expect(useLogsStore.getState().phase).toBe('choose');
    expect(useLogsStore.getState().panes).toEqual({});
    expect(useLogsStore.getState().selectedDevices).toEqual([a, b]);
    expect(screen.queryByText('gone')).toBeNull();
  });

  it('a second press right after Stop Viewing does not press Done', async () => {
    await startViewing();
    emit('/dev/cu.a', lines('kept'));
    await press('Stop Viewing');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' }))); // no clock step
    expect(useLogsStore.getState().phase).toBe('stopped');
    expect(useLogsStore.getState().panes.A1.lines).toEqual(['kept']);
  });

  it('hides Reconnect while Stop Viewing is closing the ports', async () => {
    await startViewing();
    emit('/dev/cu.a', { event: 'disconnected', data: { reason: 'gone' } });
    const release = deferred();
    holdStop = release.promise;
    await press('Stop Viewing');
    expect(useLogsStore.getState().phase).toBe('streaming');
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    await act(async () => release.resolve());
    expect(useLogsStore.getState().phase).toBe('stopped');
  });

  it('closes a monitor whose start resolves after Stop Viewing', async () => {
    const late = deferred();
    holdStart.set('/dev/cu.a', late.promise);
    await startViewing();
    await press('Stop Viewing');
    expect(stopCalls('/dev/cu.a')).toBe(1);
    await act(async () => late.resolve());
    expect(stopCalls('/dev/cu.a')).toBe(2);
    expect(stopCalls('COM7')).toBe(1);
  });

  it('stops every monitor and drops the logs if the page unmounts while viewing', async () => {
    const { unmount } = await startViewing();
    emit('/dev/cu.a', lines('gone'));
    unmount();
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: '/dev/cu.a' });
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: 'COM7' });
    expect(useLogsStore.getState().phase).toBe('choose');
    expect(useLogsStore.getState().panes).toEqual({});
  });

  it('leaving the stopped screen drops the logs, keeping the port Reconnect found', async () => {
    const { unmount } = await startViewing();
    emit('/dev/cu.a', { event: 'disconnected', data: { reason: 'gone' } });
    vi.mocked(deviceService.detectDevices).mockResolvedValue([createMockDevice({ path: '/dev/cu.new', serialNumber: 'A1', board: 'nrf52' })]);
    await act(async () => fireEvent.click(within(pane(/BlueBuzzah v2/)).getByRole('button', { name: 'Reconnect' })));
    await press('Stop Viewing');
    vi.mocked(invoke).mockClear();
    unmount();
    expect(invoke).not.toHaveBeenCalled();
    expect(useLogsStore.getState().panes).toEqual({});
    expect(useLogsStore.getState().selectedDevices).toEqual([{ ...a, path: '/dev/cu.new' }, b]);
  });
});
