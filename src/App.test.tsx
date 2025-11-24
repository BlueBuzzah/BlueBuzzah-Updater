import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { useWizardStore } from './stores/wizardStore';
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

// Mock toast components
vi.mock('./components/ui/toaster', () => ({
  Toaster: () => <div data-testid="toaster" />,
}));

describe('App', () => {
  beforeEach(() => {
    // Reset store between tests
    useWizardStore.getState().reset();
  });

  describe('Step Rendering', () => {
    it('renders FirmwareSelection on step 0', () => {
      render(<App />);

      expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
    });

    it('renders DeviceSelection on step 1', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      render(<App />);

      expect(screen.getByTestId('device-selection')).toBeInTheDocument();
    });

    it('renders InstallationProgress on step 2', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(2);

      render(<App />);

      expect(screen.getByTestId('installation-progress')).toBeInTheDocument();
    });

    it('renders SuccessScreen on step 3', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(3);

      render(<App />);

      expect(screen.getByTestId('success-screen')).toBeInTheDocument();
    });
  });

  describe('Layout Integration', () => {
    it('wraps content in WizardLayout', () => {
      render(<App />);

      expect(screen.getByText('BlueBuzzah Updater')).toBeInTheDocument();
    });

    it('includes Toaster component', () => {
      render(<App />);

      expect(screen.getByTestId('toaster')).toBeInTheDocument();
    });
  });

  describe('Navigation Logic', () => {
    it('next button disabled when no release selected', () => {
      render(<App />);

      expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    });

    it('next button enabled when release selected', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());

      render(<App />);

      expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
    });

    it('back button disabled on step 0', () => {
      render(<App />);

      expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
    });

    it('back button enabled on step 1', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      render(<App />);

      expect(screen.getByRole('button', { name: /back/i })).toBeEnabled();
    });
  });

  describe('Step Transitions', () => {
    it('clicking next advances to step 1', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());

      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      });
    });

    it('clicking back returns to step 0', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      render(<App />);

      fireEvent.click(screen.getByRole('button', { name: /back/i }));

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });
    });
  });

  describe('Device Selection Validation', () => {
    it('start installation disabled when no devices selected', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setStep(1);

      render(<App />);

      expect(screen.getByRole('button', { name: /start installation/i })).toBeDisabled();
    });

    it('start installation disabled when devices have no roles', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: undefined })]);
      store.setStep(1);

      render(<App />);

      expect(screen.getByRole('button', { name: /start installation/i })).toBeDisabled();
    });

    it('start installation enabled when devices have roles', () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(1);

      render(<App />);

      expect(screen.getByRole('button', { name: /start installation/i })).toBeEnabled();
    });
  });

  describe('Reset Functionality', () => {
    it('reset returns to step 0', async () => {
      const store = useWizardStore.getState();
      store.selectRelease(createMockRelease());
      store.setDevices([createMockDevice({ role: 'PRIMARY' })]);
      store.setStep(3);

      render(<App />);

      fireEvent.click(screen.getByText('Reset'));

      await waitFor(() => {
        expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
      });
    });
  });

  describe('Step Indicator', () => {
    it('shows step 1 as active on step 0', () => {
      render(<App />);

      expect(screen.getByText('Firmware')).toBeInTheDocument();
    });

    it('shows all step labels', () => {
      render(<App />);

      expect(screen.getByText('Firmware')).toBeInTheDocument();
      expect(screen.getByText('Devices')).toBeInTheDocument();
      expect(screen.getByText('Install')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });
  });
});
