import { Channel, invoke } from '@tauri-apps/api/core';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorEvent } from '@/types';
import { monitorService } from './MonitorService';

describe('monitorService', () => {
  it('starts a monitor with a channel that forwards events', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const onEvent = vi.fn();
    await monitorService.start('COM7', onEvent);
    const [cmd, args] = vi.mocked(invoke).mock.calls[0] as [string, { port: string; onEvent: Channel<MonitorEvent> }];
    expect(cmd).toBe('start_serial_monitor');
    expect(args.port).toBe('COM7');
    const event: MonitorEvent = { event: 'lines', data: { lines: [{ t: 1, text: 'hi' }] } };
    args.onEvent.onmessage(event);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('passes a start error through', async () => {
    vi.mocked(invoke).mockRejectedValue('Port busy');
    await expect(monitorService.start('COM7', vi.fn())).rejects.toBe('Port busy');
  });

  it('stops a monitor by port', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await monitorService.stop('COM7');
    expect(invoke).toHaveBeenCalledWith('stop_serial_monitor', { port: 'COM7' });
  });
});
