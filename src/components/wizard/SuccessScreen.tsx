import { Button } from '@/components/ui/button';
import { LogPane } from '@/components/ui/log-pane';
import { useWizardStore } from '@/stores/wizardStore';
import type { Device, FirmwareRelease } from '@/types';
import { FlashOutcome } from './FlashOutcome';

interface SuccessScreenProps {
  release: FirmwareRelease;
  devices: Device[];
  onReset: () => void;
  onClose: () => void;
}

/** The finished flash (updater.md step 4). */
export function SuccessScreen({ release, devices, onReset, onClose }: SuccessScreenProps) {
  const { logs, updateResult } = useWizardStore();
  const results = updateResult?.deviceUpdates ?? devices.map((device) => ({ device, success: true }));
  return (
    <div className="grid max-w-content gap-10">
      <FlashOutcome
        version={release.version}
        devices={devices}
        results={results}
        error={updateResult?.success === false ? updateResult.message : null}
        logText={logs.join('\n')}
        actions={
          <>
            <Button variant="secondary" onClick={onReset}>
              Flash Another Device
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        }
      />
      <LogPane lines={logs} />
    </div>
  );
}
