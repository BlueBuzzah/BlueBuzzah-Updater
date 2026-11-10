import { beforeEach, describe, expect, it } from 'vitest';
import { createMockDevice } from '@/test/factories';
import { MAX_LINES, paneKey, useLogsStore } from './logsStore';

const a = createMockDevice({ path: '/dev/cu.a', serialNumber: 'A1' });
const b = createMockDevice({ path: 'COM7', serialNumber: undefined, board: 'esp32s3' });

describe('logsStore', () => {
  beforeEach(() => useLogsStore.getState().reset());

  it('starts a fresh pane per device, keyed by serial number, else path', () => {
    useLogsStore.getState().setDevices([a, b]);
    useLogsStore.getState().startViewing();
    const { phase, panes } = useLogsStore.getState();
    expect(phase).toBe('streaming');
    expect(Object.keys(panes)).toEqual(['A1', 'COM7']);
    expect(panes.A1).toMatchObject({ port: '/dev/cu.a', lines: [], firstLine: 1, status: 'connected', follow: true, note: '' });
  });

  it('keys an empty serial number by path, so two such devices keep separate panes', () => {
    const c = createMockDevice({ path: 'COM3', serialNumber: '' });
    const d = createMockDevice({ path: 'COM4', serialNumber: '' });
    expect(paneKey(c)).toBe('COM3');
    useLogsStore.getState().setDevices([c, d]);
    useLogsStore.getState().startViewing();
    expect(Object.keys(useLogsStore.getState().panes)).toEqual(['COM3', 'COM4']);
  });

  it('caps each log at 5,000 lines, dropping the oldest and keeping the numbering', () => {
    useLogsStore.getState().setDevices([a]);
    useLogsStore.getState().startViewing();
    const lines = Array.from({ length: MAX_LINES + 3 }, (_, i) => ({ t: i, text: `line ${i + 1}` }));
    useLogsStore.getState().append('A1', lines.slice(0, 10));
    useLogsStore.getState().append('A1', lines.slice(10, MAX_LINES + 2));
    expect(useLogsStore.getState().panes.A1.firstLine).toBe(3);
    // A second overflow keeps counting from the first.
    useLogsStore.getState().append('A1', lines.slice(MAX_LINES + 2));
    const pane = useLogsStore.getState().panes.A1;
    expect(MAX_LINES).toBe(5000);
    expect(pane.lines).toHaveLength(5000);
    expect(pane.times).toHaveLength(5000);
    expect(pane.lines[0]).toBe('line 4');
    expect(pane.times[0]).toBe(3);
    expect(pane.firstLine).toBe(4);
    expect(pane.lines[4999]).toBe('line 5003');
  });

  it('stamps markers with the host time', () => {
    useLogsStore.getState().setDevices([a]);
    useLogsStore.getState().startViewing();
    const before = Date.now();
    useLogsStore.getState().appendMarker('A1', '--- Disconnected ---');
    const pane = useLogsStore.getState().panes.A1;
    expect(pane.lines).toEqual(['--- Disconnected ---']);
    expect(pane.times[0]).toBeGreaterThanOrEqual(before);
  });

  it('keeps the logs on screen when viewing stops, clearing notes', () => {
    useLogsStore.getState().setDevices([a]);
    useLogsStore.getState().startViewing();
    useLogsStore.getState().append('A1', [{ t: 1, text: 'kept' }]);
    useLogsStore.getState().setNote('A1', 'Plug the device back in, then select Reconnect.');
    useLogsStore.getState().stopViewing();
    expect(useLogsStore.getState().phase).toBe('stopped');
    expect(useLogsStore.getState().panes.A1).toMatchObject({ lines: ['kept'], note: '' });
  });

  it('leave drops the logs and keeps the selection with each current port', () => {
    useLogsStore.getState().setDevices([a, b]);
    useLogsStore.getState().startViewing();
    useLogsStore.getState().append('A1', [{ t: 1, text: 'gone' }]);
    useLogsStore.getState().setPort('A1', '/dev/cu.new');
    useLogsStore.getState().stopViewing();
    useLogsStore.getState().leave();
    const { phase, panes, selectedDevices } = useLogsStore.getState();
    expect(phase).toBe('choose');
    expect(panes).toEqual({});
    expect(selectedDevices).toEqual([{ ...a, path: '/dev/cu.new' }, b]);
    // Leaving again with no panes changes nothing.
    useLogsStore.getState().leave();
    expect(useLogsStore.getState().selectedDevices).toEqual(selectedDevices);
  });

  it('ignores updates for a pane that does not exist', () => {
    useLogsStore.getState().append('nope', [{ t: 1, text: 'x' }]);
    expect(useLogsStore.getState().panes).toEqual({});
  });
});
