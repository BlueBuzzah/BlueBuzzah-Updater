import { useLogsStore } from './logsStore';
import { useTherapyStore } from './therapyStore';
import { useWizardStore } from './wizardStore';

export type BusyKind = 'flash' | 'configure' | 'monitor';

/**
 * True while a flash or a configure write is running, or devices are being
 * viewed in Logs; leaving the page would cancel it. Flash wins, then configure.
 */
export function useIsBusy(): { busy: boolean; kind: BusyKind | null } {
  const flashing = useWizardStore((s) => s.currentStep === 2 && s.updateResult === null);
  const configuring = useTherapyStore((s) => s.step === 2 && s.result === null);
  const monitoring = useLogsStore((s) => s.viewing);
  const kind: BusyKind | null = flashing ? 'flash' : configuring ? 'configure' : monitoring ? 'monitor' : null;
  return { busy: kind !== null, kind };
}
