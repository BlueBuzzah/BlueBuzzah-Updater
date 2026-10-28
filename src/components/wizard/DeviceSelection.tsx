import { useId, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DeviceCard } from '@/components/ui/device-card';
import { ICON } from '@/components/ui/icon';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { foundStatus, useDeviceScan } from '@/hooks/useDeviceScan';
import type { BoardType, Device, DeviceRole } from '@/types';

export const BOARD_NAME: Record<BoardType, string> = { nrf52: 'BlueBuzzah v2', esp32s3: 'BlueBuzzah v3' };

const ROLE_OPTIONS: { value: DeviceRole; label: string }[] = [
  { value: 'PRIMARY', label: 'Primary' },
  { value: 'SECONDARY', label: 'Secondary' },
];

const MSG = {
  missingRole: 'Choose a role for this device.',
  duplicateRole: 'Give each device a different role: one Primary, one Secondary.',
  max: 'You can flash up to 2 devices at once.',
  mixed: "You can't flash a v2 and a v3 device together. Flash one kind at a time.",
  pruned: 'A selected device was unplugged or changed, so we deselected it.',
};

/** Empty state shared by both device lists (copy: Firmware choose devices). */
export function NoDevicesFound() {
  return (
    <div className="grid gap-4">
      <h4 className="display-l">No devices found</h4>
      <p className="body">Plug in a device with a USB data cable. Some cables only charge.</p>
      <ul className="body grid list-disc gap-2 pl-6">
        <li>Check that the device is turned on.</li>
        <li>Try a different USB port.</li>
        <li>Unplug the device, wait 5 seconds, then plug it back in.</li>
      </ul>
    </div>
  );
}

interface DeviceSelectionProps {
  selectedDevices: Device[];
  onDevicesChange: (devices: Device[]) => void;
  onRoleChange: (devicePath: string, role: DeviceRole) => void;
}

export function DeviceSelection({ selectedDevices, onDevicesChange, onRoleChange }: DeviceSelectionProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [autoAssigned, setAutoAssigned] = useState(false);
  const selectedRef = useRef(selectedDevices);
  selectedRef.current = selectedDevices;
  const errId = useId();

  // A replug can reuse a port for different hardware (Windows COM reuse),
  // and a stale board would drive the wrong flasher: drop it.
  const { devices: available, loading, error: scanError, rescan } = useDeviceScan((devices) => {
    const current = selectedRef.current;
    const stillValid = current.filter((sel) =>
      devices.some((d) => d.path === sel.path && d.board === sel.board && d.serialNumber === sel.serialNumber)
    );
    if (stillValid.length !== current.length) {
      onDevicesChange(stillValid);
      setNotice(MSG.pruned);
    }
  });

  const toggle = (device: Device) => {
    setNotice(null);
    if (selectedDevices.some((d) => d.path === device.path)) {
      onDevicesChange(selectedDevices.filter((d) => d.path !== device.path));
      setAutoAssigned(false);
      return;
    }
    if (selectedDevices.length >= 2) return setNotice(MSG.max);
    // Batch flashing is single-board only: one download, one flasher per run.
    if (selectedDevices.length > 0 && selectedDevices[0].board !== device.board) return setNotice(MSG.mixed);
    const next = [...selectedDevices, device];
    if (next.length === 2) {
      onDevicesChange(next.map((d, i) => ({ ...d, role: (i === 0 ? 'PRIMARY' : 'SECONDARY') as DeviceRole })));
      setAutoAssigned(true);
    } else {
      onDevicesChange(next);
    }
  };

  const roles = selectedDevices.map((d) => d.role);
  const duplicate = selectedDevices.length === 2 && roles[0] !== undefined && roles[0] === roles[1];
  const status = loading
    ? 'Looking for devices…'
    : scanError
      ? ''
      : foundStatus(available.length, selectedDevices.length);

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
        <p className="body-s tabular-nums text-ink-muted" aria-live="polite">{status}</p>

        {scanError && (
          <Banner tone="danger" title="Couldn't look for devices" announce>
            <p>Select Rescan to try again.</p>
            <p className="code-s mt-2 rounded-xs bg-surface-sunken p-2">{scanError}</p>
          </Banner>
        )}

        {!loading && !scanError && available.length === 0 && <NoDevicesFound />}

        {available.length > 0 && (
          <ul className="grid gap-6 sm:grid-cols-2">
            {available.map((device, i) => {
              const selected = selectedDevices.find((d) => d.path === device.path);
              const roleErr = selected && !duplicate && !selected.role ? `${errId}-${i}` : undefined;
              return (
                <li key={device.path} className="grid content-start gap-4">
                  <DeviceCard
                    name={BOARD_NAME[device.board]}
                    role={selected?.role}
                    port={device.path}
                    serial={device.serialNumber}
                    selected={!!selected}
                    onSelect={() => toggle(device)}
                  />
                  {selected && (
                    <div className="grid gap-2">
                      <SegmentedControl
                        label="Role"
                        options={ROLE_OPTIONS}
                        value={selected.role}
                        onChange={(role) => onRoleChange(device.path, role)}
                        aria-describedby={duplicate ? `${errId}-dup` : roleErr}
                      />
                      {roleErr && <p id={roleErr} className="body-s text-danger">{MSG.missingRole}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {selectedDevices.length > 0 && (
          <div className="grid gap-2">
            {autoAssigned && <p className="body-s">We set the roles for you. You can change them.</p>}
            <p className="body-s text-ink-muted">The Primary device connects to the BuzzahBuddy app. The Secondary device follows it.</p>
            {duplicate && (
              <p id={`${errId}-dup`} className="body-s flex items-start gap-2 text-danger">
                <TriangleAlert size={ICON.s} className="shrink-0" />
                {MSG.duplicateRole}
              </p>
            )}
          </div>
        )}

        <p className="body-s flex items-start gap-2" aria-live="polite">
          {notice && <TriangleAlert size={ICON.s} className="shrink-0 text-warning" />}
          {notice}
        </p>
      </div>
    </Card>
  );
}
