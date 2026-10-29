import { createMockDevice, createMockRelease } from '@/test/factories';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useTherapyStore } from './stores/therapyStore';
import { useWizardStore } from './stores/wizardStore';

// Mock the Tauri plugin process
vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(),
}));

// Mock all wizard components to simplify testing
vi.mock('./components/wizard/FirmwareSelection', () => ({
  FirmwareSelection: () => <div data-testid="firmware-selection" />,
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
  InstallationProgress: ({ onComplete }: { onComplete: (r: { success: boolean; message: string; deviceUpdates: unknown[] }) => void }) => (
    <div data-testid="installation-progress">
      <button onClick={() => onComplete({ success: true, message: 'All devices updated', deviceUpdates: [] })}>Complete</button>
    </div>
  ),
}));

vi.mock('./components/wizard/SuccessScreen', () => ({
  SuccessScreen: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="success-screen">
      <button onClick={onClose}>Reset</button>
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
  TherapyProgress: () => <div data-testid="therapy-progress" />,
  TherapySuccess: () => <div data-testid="therapy-success" />,
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(() => Promise.resolve('1.0.0')) }));

function setPlatform(p: string) {
  Object.defineProperty(navigator, 'platform', { value: p, configurable: true });
}

describe('App', () => {
  beforeEach(() => {
    useWizardStore.getState().reset();
    useTherapyStore.getState().reset();
    setPlatform('Win32');
  });

  describe('Shell', () => {
    it('shows three sections with Firmware current', () => {
      render(<App />);
      const nav = screen.getByRole('navigation', { name: 'Sections' });
      expect(nav).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Firmware' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Update Firmware' })).toBeInTheDocument();
    });

    it('Ctrl+2 opens Configure', () => {
      render(<App />);
      fireEvent.keyDown(window, { key: '2', ctrlKey: true });
      expect(screen.getByRole('heading', { level: 1, name: 'Configure Devices' })).toBeInTheDocument();
      expect(screen.getByTestId('profile-selection')).toBeInTheDocument();
    });

    it('clicking Settings opens Settings', () => {
      render(<App />);
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    });

    it('nav is locked while a flash runs', () => {
      useWizardStore.setState({ currentStep: 2, updateResult: null, selectedRelease: createMockRelease() });
      render(<App />);
      expect(screen.getByRole('button', { name: 'Configure' })).toBeDisabled();
      fireEvent.keyDown(window, { key: '2', ctrlKey: true });
      expect(screen.getByRole('heading', { level: 1, name: 'Updating Firmware' })).toBeInTheDocument();
      expect(screen.getByText('Available when the flash finishes')).toBeInTheDocument();
    });

    it('Ctrl+R asks the device list to rescan', () => {
      const onRescan = vi.fn();
      window.addEventListener('bb:rescan', onRescan);
      render(<App />);
      fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
      expect(onRescan).toHaveBeenCalledTimes(1);
      window.removeEventListener('bb:rescan', onRescan);
    });
  });

  describe('Firmware section', () => {
    it('shows device and version choices on one page', () => {
      render(<App />);
      expect(screen.getByTestId('device-selection')).toBeInTheDocument();
      expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
    });

    it.each([
      ['no devices', []],
      ['no roles', [createMockDevice({ role: undefined })]],
      ['both Primary', [createMockDevice({ path: 'a', role: 'PRIMARY' }), createMockDevice({ path: 'b', role: 'PRIMARY' })]],
      ['both Secondary', [createMockDevice({ path: 'a', role: 'SECONDARY' }), createMockDevice({ path: 'b', role: 'SECONDARY' })]],
    ])('Update Firmware is disabled with %s', (_label, devices) => {
      useWizardStore.setState({ selectedRelease: createMockRelease(), selectedDevices: devices });
      render(<App />);
      expect(screen.getByRole('button', { name: 'Update Firmware' })).toBeDisabled();
    });

    it.each([
      ['one device with a role', [createMockDevice({ role: 'PRIMARY' })]],
      ['complementary roles', [createMockDevice({ path: 'a', role: 'PRIMARY' }), createMockDevice({ path: 'b', role: 'SECONDARY' })]],
    ])('Update Firmware is enabled with %s', (_label, devices) => {
      useWizardStore.setState({ selectedRelease: createMockRelease(), selectedDevices: devices });
      render(<App />);
      expect(screen.getByRole('button', { name: 'Update Firmware' })).toBeEnabled();
    });

    it('flashing replaces the choices; the result can start over', () => {
      useWizardStore.setState({ currentStep: 2, selectedRelease: createMockRelease() });
      const { unmount } = render(<App />);
      expect(screen.getByTestId('installation-progress')).toBeInTheDocument();
      unmount();
      useWizardStore.setState({ currentStep: 3, updateResult: { success: true, message: '', deviceUpdates: [] } });
      render(<App />);
      fireEvent.click(screen.getByText('Reset'));
      expect(screen.getByTestId('firmware-selection')).toBeInTheDocument();
    });
  });
});
