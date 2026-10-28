import { useCallback, useEffect, useRef, useState } from 'react';
import { deviceService } from '@/services/DeviceService';
import type { Device } from '@/types';

/**
 * Scan for devices on mount, on demand, and on ⌘/Ctrl+R ('bb:rescan').
 * Overlapping scans resolve to the newest one.
 */
export function useDeviceScan(onScanned?: (devices: Device[]) => void) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const callId = useRef(0);
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;

  const rescan = useCallback(async () => {
    const id = ++callId.current;
    setLoading(true);
    setError(null);
    try {
      const found = await deviceService.detectDevices();
      if (id !== callId.current) return; // a newer scan owns the result
      setDevices(found);
      onScannedRef.current?.(found);
    } catch (e) {
      if (id !== callId.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === callId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    rescan();
    window.addEventListener('bb:rescan', rescan);
    return () => window.removeEventListener('bb:rescan', rescan);
  }, [rescan]);

  return { devices, loading, error, rescan };
}

export const foundStatus = (count: number, selected: number) =>
  `${count === 1 ? 'Found 1 device.' : `Found ${count} devices.`}${selected ? ` ${selected} selected` : ''}`;
