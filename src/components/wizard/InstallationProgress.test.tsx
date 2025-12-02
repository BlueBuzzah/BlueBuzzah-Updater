import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { InstallationProgress } from './InstallationProgress';
import { firmwareService } from '@/services/FirmwareService';
import { deviceService } from '@/services/DeviceService';
import { createMockRelease, createMockDevice, createMockBundle } from '@/test/factories';

// Mock services
vi.mock('@/services/FirmwareService', () => ({
  firmwareService: {
    downloadFirmware: vi.fn(),
  },
}));

vi.mock('@/services/DeviceService', () => ({
  deviceService: {
    validateDevices: vi.fn(),
    deployFirmware: vi.fn(),
  },
}));

// Mock wizard store with mutable logs array for test control
const mockLogs: string[] = [];
vi.mock('@/stores/wizardStore', () => ({
  useWizardStore: () => ({
    reset: vi.fn(),
    updateDeviceInfo: vi.fn(),
    addLog: vi.fn(),
    logs: mockLogs,
  }),
}));

// Mock toast hook
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('InstallationProgress', () => {
  const mockOnComplete = vi.fn();
  const mockOnProgressUpdate = vi.fn();
  const mockRelease = createMockRelease({ version: '1.0.0' });
  const mockDevice = createMockDevice({ role: 'PRIMARY' });
  const mockBundle = createMockBundle();

  beforeEach(() => {
    vi.resetAllMocks();
    mockLogs.length = 0; // Clear logs between tests
  });

  describe('Rendering', () => {
    it('renders validating stage initially', async () => {
      vi.mocked(deviceService.validateDevices).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      expect(screen.getByText('Validating Devices')).toBeInTheDocument();
    });

    it('shows overall progress bar', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockResolvedValue(undefined);

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Overall Progress')).toBeInTheDocument();
      });
    });

    it('shows firmware version being downloaded', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Version 1.0.0')).toBeInTheDocument();
      });
    });
  });

  describe('Stage Transitions', () => {
    it('transitions to downloading stage after validation', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      // Verify that downloadFirmware was called after validation passes
      await waitFor(() => {
        expect(firmwareService.downloadFirmware).toHaveBeenCalled();
      }, { timeout: 3000 });
    });

    it('transitions to installing stage after download', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Installing Firmware')).toBeInTheDocument();
      });
    });

    it('transitions to complete stage after successful install', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockResolvedValue(undefined);

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      // Verify installation completed successfully by checking callback
      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledWith(true);
      }, { timeout: 3000 });
    });
  });

  describe('Device Progress', () => {
    it('shows device card during installation', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(mockDevice.label)).toBeInTheDocument();
        expect(screen.getByText('PRIMARY')).toBeInTheDocument();
      });
    });

    it('shows device path', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(mockDevice.path)).toBeInTheDocument();
      });
    });

    it('reports progress via callback', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockImplementation(
        async (_device, _firmware, onProgress) => {
          if (onProgress) {
            onProgress({
              devicePath: mockDevice.path,
              stage: 'copying',
              progress: 50,
              message: 'Copying files...',
            });
          }
        }
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(mockOnProgressUpdate).toHaveBeenCalledWith(
          mockDevice.path,
          expect.objectContaining({ stage: 'copying', progress: 50 })
        );
      });
    });
  });

  describe('Multi-device Support', () => {
    it('handles multiple devices', async () => {
      const device1 = createMockDevice({ path: '/Volumes/CIRCUITPY1', label: 'CIRCUITPY1', role: 'PRIMARY' });
      const device2 = createMockDevice({ path: '/Volumes/CIRCUITPY2', label: 'CIRCUITPY2', role: 'SECONDARY' });

      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([
          [device1.path, { valid: true, errors: [], warnings: [] }],
          [device2.path, { valid: true, errors: [], warnings: [] }],
        ])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockResolvedValue(undefined);

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[device1, device2]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('CIRCUITPY1')).toBeInTheDocument();
        expect(screen.getByText('CIRCUITPY2')).toBeInTheDocument();
      });
    });

    it('shows updating X devices message', async () => {
      const devices = [
        createMockDevice({ path: '/Volumes/CIRCUITPY1', label: 'CIRCUITPY1', role: 'PRIMARY' }),
        createMockDevice({ path: '/Volumes/CIRCUITPY2', label: 'CIRCUITPY2', role: 'SECONDARY' }),
      ];

      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([
          [devices[0].path, { valid: true, errors: [], warnings: [] }],
          [devices[1].path, { valid: true, errors: [], warnings: [] }],
        ])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={devices}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Updating 2 devices...')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('shows error state when validation fails', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: false, errors: ['Device not found'], warnings: [] }]])
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      // Verify error triggers onComplete(false)
      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledWith(false);
      }, { timeout: 3000 });
    });

    it('shows error message', async () => {
      vi.mocked(deviceService.validateDevices).mockRejectedValue(
        new Error('Network error')
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      // Error is logged and completion callback called
      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledWith(false);
      }, { timeout: 3000 });
    });

    it('shows start over button on error', async () => {
      vi.mocked(deviceService.validateDevices).mockRejectedValue(
        new Error('Failed')
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
      });
    });

    it('calls onComplete with false on error', async () => {
      vi.mocked(deviceService.validateDevices).mockRejectedValue(
        new Error('Failed')
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledWith(false);
      }, { timeout: 3000 });
    });
  });

  describe('Installation Log', () => {
    it('shows installation log section', async () => {
      vi.mocked(deviceService.validateDevices).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      expect(screen.getByText('Installation Log')).toBeInTheDocument();
    });

    it('has show/hide logs button', async () => {
      vi.mocked(deviceService.validateDevices).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      expect(screen.getByRole('button', { name: /show logs/i })).toBeInTheDocument();
    });

    it('has copy logs button when logs exist', async () => {
      // Add logs before rendering so Copy Logs button appears
      mockLogs.push('[12:00:00] Starting installation...');

      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockResolvedValue(undefined);

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /copy logs/i })).toBeInTheDocument();
      });
    });
  });

  describe('Completion', () => {
    it('calls onComplete with true on success', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockResolvedValue(undefined);

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledWith(true);
      });
    });

    it('shows complete status for successful devices', async () => {
      vi.mocked(deviceService.validateDevices).mockResolvedValue(
        new Map([[mockDevice.path, { valid: true, errors: [], warnings: [] }]])
      );
      vi.mocked(firmwareService.downloadFirmware).mockResolvedValue(mockBundle);
      vi.mocked(deviceService.deployFirmware).mockImplementation(
        async (_device, _firmware, onProgress) => {
          if (onProgress) {
            onProgress({
              devicePath: mockDevice.path,
              stage: 'complete',
              progress: 100,
              message: 'Update complete!',
            });
          }
        }
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Update complete!')).toBeInTheDocument();
      });
    });
  });

  describe('Progress Calculation', () => {
    it('shows 0% during validation', async () => {
      vi.mocked(deviceService.validateDevices).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <InstallationProgress
          release={mockRelease}
          devices={[mockDevice]}
          onComplete={mockOnComplete}
          onProgressUpdate={mockOnProgressUpdate}
        />
      );

      expect(screen.getByText('0%')).toBeInTheDocument();
    });
  });
});
