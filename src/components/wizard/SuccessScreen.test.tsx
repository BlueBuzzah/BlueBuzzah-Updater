import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuccessScreen } from './SuccessScreen';
import { useWizardStore } from '@/stores/wizardStore';
import { createMockRelease, createMockDevice } from '@/test/factories';

describe('SuccessScreen', () => {
  const mockOnReset = vi.fn();
  const mockOnClose = vi.fn();
  const mockRelease = createMockRelease({ version: '1.0.0' });
  const mockDevice = createMockDevice({
    path: '/Volumes/BLUEBUZZAH',
    label: 'BLUEBUZZAH',
    role: 'PRIMARY',
  });

  beforeEach(() => {
    vi.resetAllMocks();
    useWizardStore.getState().reset();
  });

  describe('Rendering', () => {
    it('shows success message', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Installation Complete!')).toBeInTheDocument();
    });

    it('shows success checkmark', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      // Check for the checkmark icon (lucide icons render as SVG)
      const checkIcon = document.querySelector('svg');
      expect(checkIcon).toBeInTheDocument();
    });

    it('shows firmware version installed', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('1.0.0')).toBeInTheDocument();
      expect(screen.getByText('Installed Firmware')).toBeInTheDocument();
    });

    it('shows list of updated devices', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Updated Devices')).toBeInTheDocument();
      expect(screen.getByText('BLUEBUZZAH')).toBeInTheDocument();
    });

    it('shows device roles in summary', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('PRIMARY')).toBeInTheDocument();
    });

    it('shows device path', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('/Volumes/BLUEBUZZAH')).toBeInTheDocument();
    });

    it('shows update another device button', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByRole('button', { name: /update another device/i })).toBeInTheDocument();
    });

    it('shows close button', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
  });

  describe('Next Steps', () => {
    it('shows next steps section', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Next Steps')).toBeInTheDocument();
    });

    it('shows eject drives instruction', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Safely Eject Drives')).toBeInTheDocument();
    });

    it('shows power on primary instruction', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Power On PRIMARY First')).toBeInTheDocument();
    });

    it('shows power on secondary instruction', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Power On SECONDARY Within 15s')).toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('update another device button calls onReset', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /update another device/i }));

      expect(mockOnReset).toHaveBeenCalledTimes(1);
    });

    it('close button calls onClose', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /close/i }));

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Device Count', () => {
    it('shows correct device count for single device', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('1 device updated successfully')).toBeInTheDocument();
    });

    it('shows correct device count for multiple devices', () => {
      const devices = [
        createMockDevice({ path: '/Volumes/BLUEBUZZAH1', label: 'BLUEBUZZAH1', role: 'PRIMARY' }),
        createMockDevice({ path: '/Volumes/BLUEBUZZAH2', label: 'BLUEBUZZAH2', role: 'SECONDARY' }),
      ];

      render(
        <SuccessScreen
          release={mockRelease}
          devices={devices}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('2 devices updated successfully')).toBeInTheDocument();
    });
  });

  describe('Multiple Devices', () => {
    it('displays all devices', () => {
      const devices = [
        createMockDevice({ path: '/Volumes/BLUEBUZZAH1', label: 'BLUEBUZZAH1', role: 'PRIMARY' }),
        createMockDevice({ path: '/Volumes/BLUEBUZZAH2', label: 'BLUEBUZZAH2', role: 'SECONDARY' }),
      ];

      render(
        <SuccessScreen
          release={mockRelease}
          devices={devices}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('BLUEBUZZAH1')).toBeInTheDocument();
      expect(screen.getByText('BLUEBUZZAH2')).toBeInTheDocument();
    });

    it('shows both roles for multiple devices', () => {
      const devices = [
        createMockDevice({ path: '/Volumes/BLUEBUZZAH1', label: 'BLUEBUZZAH1', role: 'PRIMARY' }),
        createMockDevice({ path: '/Volumes/BLUEBUZZAH2', label: 'BLUEBUZZAH2', role: 'SECONDARY' }),
      ];

      render(
        <SuccessScreen
          release={mockRelease}
          devices={devices}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('PRIMARY')).toBeInTheDocument();
      expect(screen.getByText('SECONDARY')).toBeInTheDocument();
    });
  });

  describe('Latest Badge', () => {
    it('shows Latest badge', () => {
      render(
        <SuccessScreen
          release={mockRelease}
          devices={[mockDevice]}
          onReset={mockOnReset}
          onClose={mockOnClose}
        />
      );

      expect(screen.getByText('Latest')).toBeInTheDocument();
    });
  });
});
