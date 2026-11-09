import { Channel, invoke } from '@tauri-apps/api/core';
import type { MonitorEvent } from '@/types';

/** Read-only serial monitor (commands/monitor.rs): never writes to the device. */
export const monitorService = {
  /** Rejects if the port can't be opened or is already being viewed. */
  async start(port: string, onEvent: (event: MonitorEvent) => void): Promise<void> {
    const channel = new Channel<MonitorEvent>();
    channel.onmessage = onEvent;
    await invoke('start_serial_monitor', { port, onEvent: channel });
  },
  async stop(port: string): Promise<void> {
    await invoke('stop_serial_monitor', { port });
  },
};
