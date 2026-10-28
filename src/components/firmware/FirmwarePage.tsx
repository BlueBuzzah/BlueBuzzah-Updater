import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DeviceSelection } from '@/components/wizard/DeviceSelection';
import { FirmwareSelection } from '@/components/wizard/FirmwareSelection';
import { InstallationProgress } from '@/components/wizard/InstallationProgress';
import { SuccessScreen } from '@/components/wizard/SuccessScreen';
import { useWizardStore } from '@/stores/wizardStore';
import type { UpdateResult } from '@/types';

/** Firmware section: one focused page (updater.md Flashing firmware; plan choice PC-1). */
export function FirmwarePage() {
  const {
    currentStep,
    selectedRelease,
    selectedDevices,
    selectRelease,
    setDevices,
    updateDeviceRole,
    setUpdateProgress,
    setUpdateResult,
    setStep,
    reset,
  } = useWizardStore();

  const rolesValid =
    selectedDevices.every((d) => d.role !== undefined) &&
    (selectedDevices.length !== 2 || selectedDevices[0].role !== selectedDevices[1].role);
  const blocked =
    selectedDevices.length === 0 || !selectedRelease
      ? 'Choose a device and a version first.'
      : !rolesValid
        ? 'Choose a role for each device first.'
        : null;

  const handleComplete = (result: UpdateResult) => {
    setUpdateResult(result);
    if (result.success) setTimeout(() => setStep(3), 1000);
  };

  if (currentStep < 2) {
    return (
      <div className="grid max-w-content gap-10">
        <DeviceSelection selectedDevices={selectedDevices} onDevicesChange={setDevices} onRoleChange={updateDeviceRole} />
        <FirmwareSelection value={selectedRelease} onChange={selectRelease} board={selectedDevices[0]?.board} />
        {selectedRelease?.isPrerelease && (
          <Banner tone="warning" title="This is an experimental version">
            It&apos;s for testing and may have bugs. Use the latest release for everyday use.
          </Banner>
        )}
        <div className="grid justify-items-end gap-3">
          <Button size="xl" disabled={!!blocked} aria-describedby={blocked ? 'flash-blocked' : undefined} onClick={() => setStep(2)}>
            Update Firmware
          </Button>
          {blocked && <p id="flash-blocked" className="body-s text-right text-ink-muted">{blocked}</p>}
        </div>
      </div>
    );
  }
  if (!selectedRelease) return null;
  if (currentStep === 2) {
    return (
      <InstallationProgress release={selectedRelease} devices={selectedDevices} onComplete={handleComplete} onProgressUpdate={setUpdateProgress} />
    );
  }
  return <SuccessScreen release={selectedRelease} devices={selectedDevices} onReset={reset} onClose={reset} />;
}
