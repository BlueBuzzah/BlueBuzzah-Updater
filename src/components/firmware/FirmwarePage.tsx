import { Button } from '@/components/ui/button';
import { DeviceSelection } from '@/components/wizard/DeviceSelection';
import { FirmwareSelection } from '@/components/wizard/FirmwareSelection';
import { InstallationProgress } from '@/components/wizard/InstallationProgress';
import { SuccessScreen } from '@/components/wizard/SuccessScreen';
import { useWizardStore } from '@/stores/wizardStore';
import type { FirmwareRelease, UpdateResult } from '@/types';

/** Firmware section. ponytail: interim step flow, rebuilt as one page in the screen tasks. */
export function FirmwarePage() {
  const {
    currentStep,
    selectedRelease,
    selectedDevices,
    selectRelease,
    setDevices,
    updateDeviceRole,
    nextStep,
    previousStep,
    setUpdateProgress,
    setUpdateResult,
    setStep,
    reset,
  } = useWizardStore();

  const rolesValid =
    selectedDevices.length > 0 &&
    selectedDevices.every((d) => d.role !== undefined) &&
    (selectedDevices.length !== 2 ||
      (selectedDevices.some((d) => d.role === 'PRIMARY') && selectedDevices.some((d) => d.role === 'SECONDARY')));

  const handleComplete = (result: UpdateResult) => {
    setUpdateResult(result);
    if (result.success) setTimeout(() => setStep(3), 1000);
  };

  if (currentStep === 0) {
    return (
      <FirmwareSelection
        onSelect={(release: FirmwareRelease) => {
          selectRelease(release);
          nextStep();
        }}
      />
    );
  }
  if (currentStep === 1) {
    return (
      <div className="grid gap-10">
        <DeviceSelection selectedDevices={selectedDevices} onDevicesChange={setDevices} onRoleChange={updateDeviceRole} />
        <div className="flex justify-between gap-target-gap">
          <Button variant="quiet" onClick={previousStep}>Back</Button>
          <Button onClick={nextStep} disabled={!rolesValid}>Start Installation</Button>
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
