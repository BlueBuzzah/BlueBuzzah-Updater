import { create } from 'zustand';
import type { Device, MonitorLine, MonitorPane, MonitorStatus } from '@/types';

/** Lines kept per device; older lines are dropped and numbering continues. */
export const MAX_LINES = 5000;

/** A pane's key stays the same when Reconnect finds the device on a new port. */
export const paneKey = (device: Device) => device.serialNumber ?? device.path;

interface LogsStore {
  selectedDevices: Device[];
  viewing: boolean;
  panes: Record<string, MonitorPane>;
  setDevices: (devices: Device[]) => void;
  /** Fresh panes for the selection; the previous logs are dropped here, not on stop. */
  startViewing: () => void;
  append: (key: string, lines: MonitorLine[]) => void;
  /** A host-side line such as "--- Disconnected ---", stamped now */
  appendMarker: (key: string, text: string) => void;
  setStatus: (key: string, status: MonitorStatus) => void;
  setPort: (key: string, port: string) => void;
  setFollow: (key: string, follow: boolean) => void;
  setNote: (key: string, note: string) => void;
  /** Keeps the panes until the next startViewing */
  stopViewing: () => void;
  reset: () => void;
}

const initialState = { selectedDevices: [] as Device[], viewing: false, panes: {} as Record<string, MonitorPane> };

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
        viewing: true,
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
    stopViewing: () => set({ viewing: false }),
    reset: () => set(initialState),
  };
});
