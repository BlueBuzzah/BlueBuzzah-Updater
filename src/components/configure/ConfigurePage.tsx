import { ProfileSelection, TherapyDeviceSelection, TherapyProgress, TherapySuccess } from '@/components/therapy';
import { Button } from '@/components/ui/button';
import { useTherapyStore } from '@/stores/therapyStore';

/** Configure section. ponytail: interim step flow, rebuilt as one page in the screen tasks. */
export function ConfigurePage() {
  const { step, selectedProfile, selectedDevices, result, toggleDevice, nextStep, previousStep, setProgress, setResult, reset, setStep } =
    useTherapyStore();
  const startOver = () => {
    reset();
    setStep(0);
  };

  if (step === 0) return <ProfileSelection onSelect={() => nextStep()} />;
  if (!selectedProfile) return null;
  if (step === 1) {
    return (
      <div className="grid gap-10">
        <TherapyDeviceSelection selectedProfile={selectedProfile} selectedDevices={selectedDevices} onToggleDevice={toggleDevice} />
        <div className="flex justify-between gap-target-gap">
          <Button variant="quiet" onClick={previousStep}>Back</Button>
          <Button onClick={nextStep} disabled={selectedDevices.length === 0}>Configure Devices</Button>
        </div>
      </div>
    );
  }
  return result ? (
    <TherapySuccess profile={selectedProfile} devices={selectedDevices} result={result} onReset={startOver} onClose={startOver} />
  ) : (
    <TherapyProgress profile={selectedProfile} devices={selectedDevices} onComplete={setResult} onProgressUpdate={setProgress} />
  );
}
