import { RefreshCw } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DeviceCard } from '@/components/ui/device-card';
import { BOARD_NAME, NoDevicesFound } from '@/components/wizard/DeviceSelection';
import { foundStatus, useDeviceScan } from '@/hooks/useDeviceScan';
import type { Device } from '@/types';

interface TherapyDeviceSelectionProps {
  selectedDevices: Device[];
  onToggleDevice: (device: Device) => void;
}

/** Devices to configure: no roles here, and only devices running firmware (not in bootloader). */
export function TherapyDeviceSelection({ selectedDevices, onToggleDevice }: TherapyDeviceSelectionProps) {
  const { devices, loading, error, rescan } = useDeviceScan();
  const appMode = devices.filter((d) => !d.inBootloader);
  return (
    <Card
      title="Choose devices"
      actions={
        <Button variant="quiet" icon={RefreshCw} onClick={rescan} disabled={loading}>
          Rescan
        </Button>
      }
    >
      <div className="grid gap-6">
        <p className="body">Plug in up to 2 devices with a USB data cable.</p>
        <p className="body-s tabular-nums text-ink-muted" aria-live="polite">
          {loading ? 'Looking for devices…' : error ? '' : foundStatus(appMode.length, selectedDevices.length)}
        </p>
        {error && (
          <Banner tone="danger" title="Couldn't look for devices" announce>
            <p>Select Rescan to try again.</p>
            <p className="code-s mt-2 rounded-xs bg-surface-sunken p-2">{error}</p>
          </Banner>
        )}
        {!loading && !error && appMode.length === 0 && <NoDevicesFound />}
        {appMode.length > 0 && (
          <ul className="grid gap-6 sm:grid-cols-2">
            {appMode.map((device) => (
              <li key={device.path}>
                <DeviceCard
                  name={BOARD_NAME[device.board]}
                  port={device.path}
                  serial={device.serialNumber}
                  selected={selectedDevices.some((d) => d.path === device.path)}
                  onSelect={() => onToggleDevice(device)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
