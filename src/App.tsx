import { useState } from 'react';
import { useWizardStore } from './stores/wizardStore';
import { useTherapyStore } from './stores/therapyStore';
import { WizardLayout } from './components/layout/WizardLayout';
import { TherapyWizardLayout } from './components/layout/TherapyWizardLayout';
import { FirmwareSelection } from './components/wizard/FirmwareSelection';
import { DeviceSelection } from './components/wizard/DeviceSelection';
import { InstallationProgress } from './components/wizard/InstallationProgress';
import { SuccessScreen } from './components/wizard/SuccessScreen';
import {
  ProfileSelection,
  TherapyDeviceSelection,
  TherapyProgress,
  TherapySuccess,
} from './components/therapy';
import { HomeScreen, AppMode } from './components/home/HomeScreen';
import { Toaster } from './components/ui/toaster';
import type { FirmwareRelease, TherapyProfile } from './types';

function App() {
  const [appMode, setAppMode] = useState<AppMode>('home');

  // Firmware wizard store
  const {
    currentStep: firmwareStep,
    selectedRelease,
    selectedDevices: firmwareDevices,
    selectRelease,
    setDevices: setFirmwareDevices,
    updateDeviceRole,
    nextStep: nextFirmwareStep,
    previousStep: previousFirmwareStep,
    setUpdateProgress,
    setUpdateResult,
    setStep: setFirmwareStep,
    reset: resetFirmware,
  } = useWizardStore();

  // Therapy wizard store
  const {
    step: therapyStep,
    selectedProfile,
    selectedDevices: therapyDevices,
    result: therapyResult,
    selectProfile,
    toggleDevice,
    nextStep: nextTherapyStep,
    previousStep: previousTherapyStep,
    setProgress: setTherapyProgress,
    setResult: setTherapyResult,
    setStep: setTherapyStep,
    reset: resetTherapy,
  } = useTherapyStore();

  // =========================================================================
  // Firmware Wizard Logic
  // =========================================================================

  const canGoNextFirmware = () => {
    switch (firmwareStep) {
      case 0:
        return selectedRelease !== null;
      case 1:
        return (
          firmwareDevices.length > 0 &&
          firmwareDevices.every((d) => d.role !== undefined)
        );
      case 2:
        return false; // Can't manually proceed during installation
      case 3:
        return false; // No next on complete screen
      default:
        return false;
    }
  };

  const canGoBackFirmware = () => {
    return firmwareStep > 0 && firmwareStep < 2;
  };

  const handleNextFirmware = () => {
    if (canGoNextFirmware()) {
      nextFirmwareStep();
    }
  };

  const handleBackFirmware = () => {
    if (canGoBackFirmware()) {
      previousFirmwareStep();
    }
  };

  const handleInstallationComplete = (success: boolean) => {
    if (success) {
      setUpdateResult({
        success: true,
        message: 'All devices updated successfully',
        deviceUpdates: firmwareDevices.map((device) => ({
          device,
          success: true,
        })),
      });
      setTimeout(() => {
        setFirmwareStep(3);
      }, 1000);
    }
  };

  const handleFirmwareSelect = (release: FirmwareRelease) => {
    selectRelease(release);
    nextFirmwareStep();
  };

  // =========================================================================
  // Therapy Wizard Logic
  // =========================================================================

  const canGoNextTherapy = () => {
    switch (therapyStep) {
      case 0:
        return selectedProfile !== null;
      case 1:
        return therapyDevices.length > 0;
      case 2:
        return false; // Can't manually proceed during configuration
      default:
        return false;
    }
  };

  const canGoBackTherapy = () => {
    return therapyStep > 0 && therapyStep < 2;
  };

  const handleNextTherapy = () => {
    if (canGoNextTherapy()) {
      nextTherapyStep();
    }
  };

  const handleBackTherapy = () => {
    if (canGoBackTherapy()) {
      previousTherapyStep();
    }
  };

  const handleProfileSelect = (profile: TherapyProfile) => {
    selectProfile(profile);
    nextTherapyStep();
  };

  // =========================================================================
  // Navigation Handlers
  // =========================================================================

  const handleBackToHome = () => {
    resetFirmware();
    resetTherapy();
    setAppMode('home');
  };

  const handleResetFirmware = () => {
    resetFirmware();
  };

  const handleResetTherapy = () => {
    resetTherapy();
    setTherapyStep(0);
  };

  // =========================================================================
  // Render Logic
  // =========================================================================

  // Home Screen
  if (appMode === 'home') {
    return (
      <>
        <HomeScreen onSelectMode={setAppMode} />
        <Toaster />
      </>
    );
  }

  // Firmware Wizard
  if (appMode === 'firmware') {
    const renderFirmwareStep = () => {
      switch (firmwareStep) {
        case 0:
          return <FirmwareSelection onSelect={handleFirmwareSelect} />;
        case 1:
          return (
            <DeviceSelection
              selectedDevices={firmwareDevices}
              onDevicesChange={setFirmwareDevices}
              onRoleChange={updateDeviceRole}
            />
          );
        case 2:
          return selectedRelease ? (
            <InstallationProgress
              release={selectedRelease}
              devices={firmwareDevices}
              onComplete={handleInstallationComplete}
              onProgressUpdate={setUpdateProgress}
            />
          ) : null;
        case 3:
          return selectedRelease ? (
            <SuccessScreen
              release={selectedRelease}
              devices={firmwareDevices}
              onReset={handleResetFirmware}
              onClose={handleBackToHome}
            />
          ) : null;
        default:
          return null;
      }
    };

    return (
      <>
        <WizardLayout
          currentStep={firmwareStep}
          canGoNext={canGoNextFirmware()}
          canGoBack={canGoBackFirmware()}
          onNext={handleNextFirmware}
          onBack={handleBackFirmware}
          onBackToHome={handleBackToHome}
        >
          {renderFirmwareStep()}
        </WizardLayout>
        <Toaster />
      </>
    );
  }

  // Therapy Wizard
  if (appMode === 'therapy') {
    const renderTherapyStep = () => {
      switch (therapyStep) {
        case 0:
          return (
            <ProfileSelection
              selectedProfile={selectedProfile}
              onSelect={handleProfileSelect}
            />
          );
        case 1:
          return selectedProfile ? (
            <TherapyDeviceSelection
              selectedProfile={selectedProfile}
              selectedDevices={therapyDevices}
              onToggleDevice={toggleDevice}
            />
          ) : null;
        case 2:
          return selectedProfile && therapyResult ? (
            <TherapySuccess
              profile={selectedProfile}
              devices={therapyDevices}
              result={therapyResult}
              onReset={handleResetTherapy}
              onClose={handleBackToHome}
            />
          ) : selectedProfile ? (
            <TherapyProgress
              profile={selectedProfile}
              devices={therapyDevices}
              onComplete={(result) => {
                setTherapyResult(result);
              }}
              onProgressUpdate={setTherapyProgress}
            />
          ) : null;
        default:
          return null;
      }
    };

    return (
      <>
        <TherapyWizardLayout
          currentStep={therapyStep}
          canGoNext={canGoNextTherapy()}
          canGoBack={canGoBackTherapy()}
          onNext={handleNextTherapy}
          onBack={handleBackTherapy}
          onBackToHome={handleBackToHome}
        >
          {renderTherapyStep()}
        </TherapyWizardLayout>
        <Toaster />
      </>
    );
  }

  return null;
}

export default App;
