import { useTherapyStore } from './therapyStore';
import { useWizardStore } from './wizardStore';

export type BusyKind = 'flash' | 'configure';

/** True while a flash or a configure write is running; leaving the page would cancel it. */
export function useIsBusy(): { busy: boolean; kind: BusyKind | null } {
  const flashing = useWizardStore((s) => s.currentStep === 2 && s.updateResult === null);
  const configuring = useTherapyStore((s) => s.step === 2 && s.result === null);
  const kind: BusyKind | null = flashing ? 'flash' : configuring ? 'configure' : null;
  return { busy: kind !== null, kind };
}
