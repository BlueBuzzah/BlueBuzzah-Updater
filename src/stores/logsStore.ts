import { create } from 'zustand';
import type { Device, MonitorLine, MonitorPane, MonitorStatus } from '@/types';

/** Lines kept per device; older lines are dropped and numbering continues. */
export const MAX_LINES = 5000;

/** A pane's key stays the same when Reconnect finds the device on a new port. */
export const paneKey = (device: Device) => device.serialNumber || device.path;

/** choose devices → streaming → stopped (logs still on screen) → leave purges them */
export type LogsPhase = 'choose' | 'streaming' | 'stopped';

interface LogsStore {
  selectedDevices: Device[];
  phase: LogsPhase;
  panes: Record<string, MonitorPane>;
  setDevices: (devices: Device[]) => void;
  /** Fresh panes for the selection */
  startViewing: () => void;
  append: (key: string, lines: MonitorLine[]) => void;
  /** A host-side line such as "--- Disconnected ---", stamped now */
  appendMarker: (key: string, text: string) => void;
  setStatus: (key: string, status: MonitorStatus) => void;
  setPort: (key: string, port: string) => void;
  setFollow: (key: string, follow: boolean) => void;
  setNote: (key: string, note: string) => void;
  /** Streaming has ended; the panes stay on screen to copy or save */
  stopViewing: () => void;
  /**
   * Back to choosing: drops every log from memory. The selection is kept, with each
   * device's current port, so a device Reconnect found on a new port isn't pruned.
   */
  leave: () => void;
  reset: () => void;
}

const initialState = { selectedDevices: [] as Device[], phase: 'choose' as LogsPhase, panes: {} as Record<string, MonitorPane> };

export const useLogsStore = create<LogsStore>((set) => {
  const update = (key: string, change: (pane: MonitorPane) => Partial<MonitorPane>) =>
    set((state) => {
      const pane = state.panes[key];
      return pane ? { panes: { ...state.panes, [key]: { ...pane, ...change(pane) } } } : {};
    });
  const append = (key: string, lines: MonitorLine[]) =>
    update(key, (pane) => {
      const all = pane.lines.concat(lines.map((l) => l.text));
      const times = pane.times.concat(lines.map((l) => l.t));
      const dropped = Math.max(all.length - MAX_LINES, 0);
      return { lines: all.slice(dropped), times: times.slice(dropped), firstLine: pane.firstLine + dropped };
    });

  return {
    ...initialState,
    setDevices: (devices) => set({ selectedDevices: devices }),
    startViewing: () =>
      set((state) => ({
        phase: 'streaming',
        panes: Object.fromEntries(
          state.selectedDevices.map((device) => [
            paneKey(device),
            { device, port: device.path, lines: [], times: [], firstLine: 1, status: 'connected', follow: true, note: '' } satisfies MonitorPane,
          ])
        ),
      })),
    append,
    appendMarker: (key, text) => append(key, [{ t: Date.now(), text }]),
    setStatus: (key, status) => update(key, () => ({ status })),
    setPort: (key, port) => update(key, () => ({ port })),
    setFollow: (key, follow) => update(key, () => ({ follow })),
    setNote: (key, note) => update(key, () => ({ note })),
    // Notes point at Reconnect, which the stopped screen doesn't offer.
    stopViewing: () =>
      set((state) => ({
        phase: 'stopped',
        panes: Object.fromEntries(Object.entries(state.panes).map(([key, pane]) => [key, { ...pane, note: '' }])),
      })),
    leave: () =>
      set((state) => ({
        phase: 'choose',
        panes: {},
        selectedDevices: state.selectedDevices.map((d) => {
          const pane = state.panes[paneKey(d)];
          return pane ? { ...pane.device, path: pane.port } : d;
        }),
      })),
    reset: () => set(initialState),
  };
});
