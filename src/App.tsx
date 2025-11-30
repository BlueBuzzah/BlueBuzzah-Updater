import { useWizardStore } from './stores/wizardStore';
import { WizardLayout } from './components/layout/WizardLayout';
import { FirmwareSelection } from './components/wizard/FirmwareSelection';
import { DeviceSelection } from './components/wizard/DeviceSelection';
import { InstallationProgress } from './components/wizard/InstallationProgress';
import { SuccessScreen } from './components/wizard/SuccessScreen';
import { Toaster } from './components/ui/toaster';
import { exit } from '@tauri-apps/plugin-process';
import type { FirmwareRelease } from './types';

function App() {
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

  const canGoNext = () => {
    switch (currentStep) {
      case 0:
        return selectedRelease !== null;
      case 1:
        return (
          selectedDevices.length > 0 &&
          selectedDevices.every((d) => d.role !== undefined)
        );
      case 2:
        return false; // Can't manually proceed during installation
      case 3:
        return false; // No next on complete screen
      default:
        return false;
    }
  };

  const canGoBack = () => {
    return currentStep > 0 && currentStep < 2; // Can't go back during/after installation
  };

  const handleNext = () => {
    if (canGoNext()) {
      nextStep();
    }
  };

  const handleBack = () => {
    if (canGoBack()) {
      previousStep();
    }
  };

  const handleInstallationComplete = (success: boolean) => {
    if (success) {
      setUpdateResult({
        success: true,
        message: 'All devices updated successfully',
        deviceUpdates: selectedDevices.map((device) => ({
          device,
          success: true,
        })),
      });
      // Move to success screen after a brief delay
      setTimeout(() => {
        setStep(3);
      }, 1000);
    }
  };

  const handleReset = () => {
    reset();
  };

  const handleClose = async () => {
    await exit(0);
  };

  const handleFirmwareSelect = (release: FirmwareRelease) => {
    selectRelease(release);
    nextStep();
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <FirmwareSelection
            onSelect={handleFirmwareSelect}
          />
        );
      case 1:
        return (
          <DeviceSelection
            selectedDevices={selectedDevices}
            onDevicesChange={setDevices}
            onRoleChange={updateDeviceRole}
          />
        );
      case 2:
        return selectedRelease ? (
          <InstallationProgress
            release={selectedRelease}
            devices={selectedDevices}
            onComplete={handleInstallationComplete}
            onProgressUpdate={setUpdateProgress}
          />
        ) : null;
      case 3:
        return selectedRelease ? (
          <SuccessScreen
            release={selectedRelease}
            devices={selectedDevices}
            onReset={handleReset}
            onClose={handleClose}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <>
      <WizardLayout
        currentStep={currentStep}
        canGoNext={canGoNext()}
        canGoBack={canGoBack()}
        onNext={handleNext}
        onBack={handleBack}
      >
        {renderStep()}
      </WizardLayout>
      <Toaster />
    </>
  );
}

export default App;
