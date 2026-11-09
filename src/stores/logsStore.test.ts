import { beforeEach, describe, expect, it } from 'vitest';
import { createMockDevice } from '@/test/factories';
import { MAX_LINES, useLogsStore } from './logsStore';

const a = createMockDevice({ path: '/dev/cu.a', serialNumber: 'A1' });
const b = createMockDevice({ path: 'COM7', serialNumber: undefined, board: 'esp32s3' });

describe('logsStore', () => {
  beforeEach(() => useLogsStore.getState().reset());

  it('starts a fresh pane per device, keyed by serial number, else path', () => {
    useLogsStore.getState().setDevices([a, b]);
    useLogsStore.getState().startViewing();
    const { viewing, panes } = useLogsStore.getState();
    expect(viewing).toBe(true);
    expect(Object.keys(panes)).toEqual(['A1', 'COM7']);
    expect(panes.A1).toMatchObject({ port: '/dev/cu.a', lines: [], firstLine: 1, status: 'connected', follow: true, note: '' });
  });

  it('caps each log at 5,000 lines, dropping the oldest and keeping the numbering', () => {
    useLogsStore.getState().setDevices([a]);
    useLogsStore.getState().startViewing();
    const lines = Array.from({ length: MAX_LINES + 2 }, (_, i) => ({ t: i, text: `line ${i + 1}` }));
    useLogsStore.getState().append('A1', lines.slice(0, 10));
    useLogsStore.getState().append('A1', lines.slice(10));
    const pane = useLogsStore.getState().panes.A1;
    expect(MAX_LINES).toBe(5000);
    expect(pane.lines).toHaveLength(5000);
    expect(pane.times).toHaveLength(5000);
    expect(pane.lines[0]).toBe('line 3');
    expect(pane.times[0]).toBe(2);
    expect(pane.firstLine).toBe(3);
    expect(pane.lines[4999]).toBe('line 5002');
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

  it('keeps the logs when viewing stops, until the next start', () => {
    useLogsStore.getState().setDevices([a]);
    useLogsStore.getState().startViewing();
    useLogsStore.getState().append('A1', [{ t: 1, text: 'kept' }]);
    useLogsStore.getState().setPort('A1', '/dev/cu.new');
    useLogsStore.getState().stopViewing();
    expect(useLogsStore.getState().viewing).toBe(false);
    expect(useLogsStore.getState().panes.A1).toMatchObject({ lines: ['kept'], port: '/dev/cu.new' });
    useLogsStore.getState().startViewing();
    expect(useLogsStore.getState().panes.A1).toMatchObject({ lines: [], port: '/dev/cu.a' });
  });

  it('ignores updates for a pane that does not exist', () => {
    useLogsStore.getState().append('nope', [{ t: 1, text: 'x' }]);
    expect(useLogsStore.getState().panes).toEqual({});
  });
});
