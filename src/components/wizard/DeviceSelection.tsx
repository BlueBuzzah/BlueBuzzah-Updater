import { useId, useRef, useState } from 'react';
import { Radar, TriangleAlert } from 'lucide-react';
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
  max: { flash: 'You can flash up to 2 devices at once.', configure: 'You can configure up to 2 devices at once.' },
  mixed: "You can't flash a v2 and a v3 device together. Flash one kind at a time.",
  pruned: 'A selected device was unplugged or changed, so we deselected it.',
  sameSettings:
    'Give both devices the same settings so they work properly as a pair. If only one is plugged in, configure the other one the same way next.',
};

/** Empty state (copy: Firmware choose devices). */
function NoDevicesFound() {
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
  /**
   * flash: roles and one board version per run. configure: no roles, any mix
   * of boards, and only devices running firmware (settings can't be written to
   * a device in bootloader mode).
   */
  mode?: 'flash' | 'configure';
  selectedDevices: Device[];
  onDevicesChange: (devices: Device[]) => void;
  onRoleChange?: (devicePath: string, role: DeviceRole) => void;
}

/** The Choose Devices card, shared by the Firmware and Configure pages. */
export function DeviceSelection({ mode = 'flash', selectedDevices, onDevicesChange, onRoleChange }: DeviceSelectionProps) {
  const flash = mode === 'flash';
  const [notice, setNotice] = useState<string | null>(null);
  const [autoAssigned, setAutoAssigned] = useState(false);
  const selectedRef = useRef(selectedDevices);
  selectedRef.current = selectedDevices;
  const errId = useId();
  const usable = (devices: Device[]) => (flash ? devices : devices.filter((d) => !d.inBootloader));
  const withRoles = (devices: Device[]) =>
    devices.map((d, i) => ({ ...d, role: (i === 0 ? 'PRIMARY' : 'SECONDARY') as DeviceRole }));

  // A replug can reuse a port for different hardware (Windows COM reuse),
  // and a stale board would drive the wrong flasher: drop it.
  const { devices: found, loading, error: scanError, rescan } = useDeviceScan((devices) => {
    const current = selectedRef.current;
    const stillValid = current.filter((sel) =>
      devices.some((d) => d.path === sel.path && d.board === sel.board && d.serialNumber === sel.serialNumber)
    );
    // Exactly 2 found with nothing selected: select both (one kind only when flashing).
    const pair = usable(devices);
    if (stillValid.length === 0 && pair.length === 2 && (!flash || pair[0].board === pair[1].board)) {
      onDevicesChange(flash ? withRoles(pair) : pair);
      setAutoAssigned(flash);
      setNotice(null);
      return;
    }
    if (stillValid.length !== current.length) {
      onDevicesChange(stillValid);
      setNotice(MSG.pruned);
    }
  });
  const available = usable(found);

  const toggle = (device: Device) => {
    setNotice(null);
    if (selectedDevices.some((d) => d.path === device.path)) {
      onDevicesChange(selectedDevices.filter((d) => d.path !== device.path));
      setAutoAssigned(false);
      return;
    }
    if (selectedDevices.length >= 2) return setNotice(MSG.max[mode]);
    // Batch flashing is single-board only: one download, one flasher per run.
    if (flash && selectedDevices.length > 0 && selectedDevices[0].board !== device.board) return setNotice(MSG.mixed);
    const next = [...selectedDevices, device];
    if (flash && next.length === 2) {
      onDevicesChange(withRoles(next));
      setAutoAssigned(true);
    } else {
      onDevicesChange(next);
    }
  };

  const roles = selectedDevices.map((d) => d.role);
  const duplicate = flash && selectedDevices.length === 2 && roles[0] !== undefined && roles[0] === roles[1];
  const status = loading
    ? 'Looking for devices…'
    : scanError
      ? ''
      : foundStatus(available.length, selectedDevices.length);

  return (
    <Card
      title="Choose Devices"
      actions={
        <Button variant="quiet" icon={Radar} onClick={rescan} disabled={loading}>
          Rescan
        </Button>
      }
    >
      <div className="grid gap-6">
        <p className="body">Plug in up to 2 devices with a USB data cable.</p>
        {!flash && <p className="body-s text-ink-muted">{MSG.sameSettings}</p>}
        <p className="body-s tabular-nums text-ink-muted" aria-live="polite">{status}</p>

        {scanError && (
          <Banner tone="danger" title="Couldn't look for devices" announce>
            <p>Select Rescan to try again.</p>
            <p className="code-s rounded-xs bg-surface-sunken p-2">{scanError}</p>
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
                    role={flash ? selected?.role : undefined}
                    port={device.path}
                    serial={device.serialNumber}
                    selected={!!selected}
                    onSelect={() => toggle(device)}
                  />
                  {flash && selected && (
                    <div className="grid gap-2">
                      <SegmentedControl
                        label="Role"
                        options={ROLE_OPTIONS}
                        value={selected.role}
                        onChange={(role) => onRoleChange?.(device.path, role)}
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

        {flash && selectedDevices.length > 0 && (
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
