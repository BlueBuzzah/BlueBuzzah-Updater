import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { useWizardStore } from './stores/wizardStore';
import { useTherapyStore } from './stores/therapyStore';
import { createMockRelease, createMockDevice } from '@/test/factories';

// Mock the Tauri plugin process
vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(),
}));

// Mock all wizard components to simplify testing
vi.mock('./components/wizard/FirmwareSelection', () => ({
  FirmwareSelection: ({ onSelect }: { onSelect: (r: unknown) => void }) => (
    <div data-testid="firmware-selection">
      <button onClick={() => onSelect(createMockRelease())}>Select Firmware</button>
    </div>
  ),
}));

vi.mock('./components/wizard/DeviceSelection', () => ({
  DeviceSelection: ({ onDevicesChange }: { onDevicesChange: (d: unknown[]) => void }) => (
    <div data-testid="device-selection">
      <button onClick={() => onDevicesChange([createMockDevice({ role: 'PRIMARY' })])}>
        Select Device
      </button>
    </div>
  ),
}));

vi.mock('./components/wizard/InstallationProgress', () => ({
  InstallationProgress: ({ onComplete }: { onComplete: (s: boolean) => void }) => (
    <div data-testid="installation-progress">
      <button onClick={() => onComplete(true)}>Complete</button>
    </div>
  ),
}));

vi.mock('./components/wizard/SuccessScreen', () => ({
  SuccessScreen: ({ onReset }: { onReset: () => void }) => (
    <div data-testid="success-screen">
      <button onClick={onReset}>Reset</button>
    </div>
  ),
}));

// Mock therapy components
vi.mock('./components/therapy', () => ({
  ProfileSelection: ({ onSelect }: { onSelect: (p: string) => void }) => (
    <div data-testid="profile-selection">
      <button onClick={() => onSelect('REGULAR')}>Select Profile</button>
    </div>
  ),
  TherapyDeviceSelection: () => <div data-testid="therapy-device-selection" />,
  TherapyProgress: () => <div data-testid="therapy-progress" />,
  TherapySuccess: () => <div data-testid="therapy-success" />,
}));

// Mock toast components
vi.mock('./components/ui/toaster', () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

describe('App', () => {
  beforeEach(() => {
    // Reset stores between tests
    useWizardStore.getState().reset();
    useTherapyStore.getState().reset();
  });

  describe('Home Screen', () => {
    it('renders home screen by default', () => {
      render(<App />);

      expect(screen.getByText('BlueBuzzah Updater')).toBeInTheDocument();
      expect(screen.getByText('What would you like to do?')).toBeInTheDocument();
    });

    it('shows Firmware Update option', () => {
      render(<App />);

      expect(screen.getByText('Firmware Update')).toBeInTheDocument();
    });

    it('shows Set Therapy Profile option', () => {
      render(<App />);

      expect(screen.getByText('Set Therapy Profile')).toBeInTheDocument();
    });

    it('clicking Firmware Update enters firmware mode', async () => {
      render(<App />);

      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });
    });

    it('clicking Set Therapy Profile enters therapy mode', async () => {
      render(<App />);

      fireEvent.click(screen.getByText('Set Therapy Profile'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-selection')).toBeInTheDocument();
      });
    });

    it('includes Toaster component', () => {
      render(<App />);

      expect(screen.getByTestId('toaster')).toBeInTheDocument();
    });
  });

  describe('Firmware Wizard - Step Rendering', () => {
    const enterFirmwareMode = () => {
      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));
    };

    it('renders FirmwareSelection on step 0', async () => {
      enterFirmwareMode();

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });
    });

    it('renders DeviceSelection on step 1', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      enterFirmwareMode();

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });
    });

    it('renders InstallationProgress on step 2', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(2);

      enterFirmwareMode();

      await waitFor(() => {
        expect(screen.getByTestId('installation-progress')).toBeInTheDocument();
      });
    });

    it('renders SuccessScreen on step 3', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(3);

      enterFirmwareMode();

      await waitFor(() => {
        expect(screen.getByTestId('success-screen')).toBeInTheDocument();
      });
    });
  });

  describe('Firmware Wizard - Layout Integration', () => {
    it('wraps content in WizardLayout', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        // Check for the wizard layout header
        expect(screen.getByText('Firmware update tool for BlueBuzzah devices')).toBeInTheDocument();
      });
    });
  });

  describe('Firmware Wizard - Navigation Logic', () => {
    it('hides navigation footer on step 0', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });

      // No Back/Next buttons on firmware selection step
      expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
    });

    it('back button enabled on step 1', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /^back$/i })).toBeEnabled();
    });
  });

  describe('Firmware Wizard - Step Transitions', () => {
    it('selecting firmware auto-advances to step 1', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });

      // Click the "Select Firmware" button in the mocked component
      fireEvent.click(screen.getByText('Select Firmware'));

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });
    });

    it('clicking back returns to step 0', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /^back$/i }));

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });
    });
  });

  describe('Firmware Wizard - Device Selection Validation', () => {
    it('start installation disabled when no devices selected', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /start installation/i })).toBeDisabled();
    });

    it('start installation disabled when devices have no roles', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: undefined })]);
      store.setStep(1);

      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /start installation/i })).toBeDisabled();
    });

    it('start installation enabled when devices have roles', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(1);

      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /start installation/i })).toBeEnabled();
    });
  });

  describe('Firmware Wizard - Reset Functionality', () => {
    it('reset restarts the firmware wizard', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(3);

      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByTestId('success-screen')).toBeInTheDocument();
      });

      // Reset keeps you in firmware mode but restarts the wizard
      fireEvent.click(screen.getByText('Reset'));

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });
    });
  });

  describe('Firmware Wizard - Step Indicator', () => {
    it('shows all step labels', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Firmware Update'));

      await waitFor(() => {
        expect(screen.getByText('Firmware')).toBeInTheDocument();
      });

      expect(screen.getByText('Devices')).toBeInTheDocument();
      expect(screen.getByText('Install')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });
  });

  describe('Therapy Wizard', () => {
    it('shows profile selection on entry', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Set Therapy Profile'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-selection')).toBeInTheDocument();
      });
    });

    it('shows Set Therapy Profile header', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Set Therapy Profile'));

      await waitFor(() => {
        expect(screen.getByText('Set Therapy Profile')).toBeInTheDocument();
      });
    });

    it('has Home button to return', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Set Therapy Profile'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
      });
    });

    it('clicking Home returns to home screen', async () => {
      render(<App />);
      fireEvent.click(screen.getByText('Set Therapy Profile'));

      await waitFor(() => {
        expect(screen.getByTestId('profile-selection')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /home/i }));

      await waitFor(() => {
        expect(screen.getByText('What would you like to do?')).toBeInTheDocument();
      });
    });
  });
});
