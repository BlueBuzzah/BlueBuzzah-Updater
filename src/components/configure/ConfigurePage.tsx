import { ProfileSelection, TherapyProgress, TherapySuccess } from '@/components/therapy';
import { ActionBar } from '@/components/shell/ActionBar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { DeviceSelection } from '@/components/wizard/DeviceSelection';
import { IMPLANT_NOTICE, MEDICAL_DISCLAIMER } from '@/lib/legal';
import { CUSTOM_DEFAULTS, validateCustomParams } from '@/lib/therapy-bounds';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTherapyStore } from '@/stores/therapyStore';

/** Configure section: one page, like Firmware (plan choice PC-1); the legal notices are its one Banner (PC-15). */
export function ConfigurePage() {
  const { step, selectedProfile, selectedDevices, result, setDevices, setProgress, setResult, reset, setStep } = useTherapyStore();
  const settings = useSettingsStore((s) => s.settings);
  const startOver = () => {
    reset();
    setStep(0);
  };

  const values = settings.customProfile ?? CUSTOM_DEFAULTS;
  const invalid = selectedProfile === 'CUSTOM' && Object.keys(validateCustomParams(values)).length > 0;
  const blocked = !selectedProfile || selectedDevices.length === 0
    ? 'Choose a pattern and at least one device first.'
    : invalid
      ? 'Fix the highlighted settings first.'
      : null;

  if (step < 2) {
    return (
      <>
        <div className="grid max-w-content gap-10">
          <Banner tone="info">
            <p>{MEDICAL_DISCLAIMER}</p>
            <p>{IMPLANT_NOTICE}</p>
          </Banner>
          <ProfileSelection />
          <DeviceSelection mode="configure" selectedDevices={selectedDevices} onDevicesChange={setDevices} />
        </div>
        <ActionBar hint={blocked} hintId="apply-blocked">
          <Button size="lg" guardRepeat disabled={!!blocked} aria-describedby={blocked ? 'apply-blocked' : undefined} onClick={() => setStep(2)}>
            {selectedDevices.length === 1 ? 'Apply to Device' : 'Apply to Devices'}
          </Button>
        </ActionBar>
      </>
    );
  }
  if (!selectedProfile) return null;
  return result ? (
    <TherapySuccess profile={selectedProfile} devices={selectedDevices} result={result} onReset={startOver} onClose={startOver} />
  ) : (
    <TherapyProgress profile={selectedProfile} devices={selectedDevices} onComplete={setResult} onProgressUpdate={setProgress} />
  );
}
