import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { DeviceSelection } from './DeviceSelection';
import { deviceService } from '@/services/DeviceService';
import { createMockDevice, createMockDevices } from '@/test/factories';

// Mock the device service
vi.mock('@/services/DeviceService', () => ({
  deviceService: {
    detectDevices: vi.fn(),
  },
}));

// Mock the toast hook
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('DeviceSelection', () => {
  const mockOnDevicesChange = vi.fn();
  const mockOnRoleChange = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Loading State', () => {
    it('renders loading state while detecting', async () => {
      let resolveDetect: (value: never[]) => void;
      vi.mocked(deviceService.detectDevices).mockImplementation(
        () => new Promise((resolve) => { resolveDetect = resolve as (value: never[]) => void; })
      );

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      expect(screen.getByText('Detecting devices...')).toBeInTheDocument();

      // Resolve the promise to allow cleanup
      await act(async () => {
        resolveDetect!([]);
      });
    });

    it('shows spinner during loading', async () => {
      let resolveDetect: (value: never[]) => void;
      vi.mocked(deviceService.detectDevices).mockImplementation(
        () => new Promise((resolve) => { resolveDetect = resolve as (value: never[]) => void; })
      );

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();

      // Resolve the promise to allow cleanup
      await act(async () => {
        resolveDetect!([]);
      });
    });
  });

  describe('Rendering Devices', () => {
    it('renders device list on success', async () => {
      const mockDevices = [
        createMockDevice({ path: '/dev/cu.usbmodem1234', label: 'Feather nRF52840' }),
        createMockDevice({ path: '/dev/cu.usbmodem5678', label: 'Feather nRF52840 #2' }),
      ];
      vi.mocked(deviceService.detectDevices).mockResolvedValue(mockDevices);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Feather nRF52840')).toBeInTheDocument();
        expect(screen.getByText('Feather nRF52840 #2')).toBeInTheDocument();
      });
    });

    it('shows device label and path', async () => {
      const mockDevice = createMockDevice({
        path: '/dev/cu.usbmodem1234',
        label: 'Feather nRF52840',
      });
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Feather nRF52840')).toBeInTheDocument();
        expect(screen.getByText('/dev/cu.usbmodem1234')).toBeInTheDocument();
      });
    });

    it('shows device serial number when available', async () => {
      const mockDevice = createMockDevice({
        path: '/dev/cu.usbmodem1234',
        label: 'Feather nRF52840',
        serialNumber: 'SN12345678',
      });
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('S/N: SN12345678')).toBeInTheDocument();
      });
    });

    it('does not show serial number when not available', async () => {
      const mockDevice = createMockDevice({
        path: '/dev/cu.usbmodem1234',
        label: 'Feather nRF52840',
        serialNumber: undefined,
      });
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Feather nRF52840')).toBeInTheDocument();
      });

      expect(screen.queryByText(/S\/N:/)).not.toBeInTheDocument();
    });

    it('shows device count badge', async () => {
      const mockDevices = createMockDevices(3);
      vi.mocked(deviceService.detectDevices).mockResolvedValue(mockDevices);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('3 devices found')).toBeInTheDocument();
      });
    });
  });

  describe('No Devices Found', () => {
    it('renders no devices found message', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('No BlueBuzzah Devices Found')).toBeInTheDocument();
      });
    });

    it('shows troubleshooting tips', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Troubleshooting:')).toBeInTheDocument();
        expect(screen.getByText(/Check USB cable connection/)).toBeInTheDocument();
      });
    });

    it('shows try again button', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
      });
    });
  });

  describe('Device Selection', () => {
    it('clicking device toggles selection', async () => {
      const mockDevice = createMockDevice();
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Feather nRF52840')).toBeInTheDocument();
      });

      // Click the card to select
      fireEvent.click(screen.getByText('Feather nRF52840'));

      expect(mockOnDevicesChange).toHaveBeenCalledWith([mockDevice]);
    });

    it('shows checkmark for selected device', async () => {
      const mockDevice = createMockDevice();
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[mockDevice]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        // Selected device should show checkmark icon (SVG within the card)
        const cards = document.querySelectorAll('.ring-2');
        expect(cards.length).toBe(1);
      });
    });

    it('selected device shows ring styling', async () => {
      const mockDevice = createMockDevice();
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[mockDevice]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        const cards = document.querySelectorAll('.ring-2');
        expect(cards.length).toBe(1);
      });
    });

    it('shows selected count badge', async () => {
      const mockDevices = createMockDevices(3);
      vi.mocked(deviceService.detectDevices).mockResolvedValue(mockDevices);

      render(
        <DeviceSelection
          selectedDevices={[mockDevices[0], mockDevices[1]]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('2 selected')).toBeInTheDocument();
      });
    });
  });

  describe('Role Assignment', () => {
    it('shows role dropdown for selected device', async () => {
      const mockDevice = createMockDevice();
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[mockDevice]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Device Role')).toBeInTheDocument();
      });
    });

    it('auto-assigns roles when selecting 2 devices', async () => {
      const mockDevices = createMockDevices(2);
      vi.mocked(deviceService.detectDevices).mockResolvedValue(mockDevices);

      // Start with one device selected
      render(
        <DeviceSelection
          selectedDevices={[mockDevices[0]]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Feather nRF52840 #1')).toBeInTheDocument();
      });

      // Click second device
      fireEvent.click(screen.getByText('Feather nRF52840 #2'));

      // Should call onDevicesChange with both devices and auto-assigned roles
      expect(mockOnDevicesChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'PRIMARY' }),
          expect.objectContaining({ role: 'SECONDARY' }),
        ])
      );
    });

    it('displays role description', async () => {
      const mockDevice = createMockDevice({ role: 'PRIMARY' });
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[mockDevice]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Primary device coordinates communication')).toBeInTheDocument();
      });
    });

    it('shows warning when roles not assigned', async () => {
      const mockDevice = createMockDevice({ role: undefined });
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[mockDevice]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('All selected devices must have a role assigned.')).toBeInTheDocument();
      });
    });
  });

  describe('Refresh', () => {
    it('refresh button re-detects devices', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([createMockDevice()]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Feather nRF52840')).toBeInTheDocument();
      });

      // Click refresh and wait for re-detection to complete
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      });

      // Wait for the refresh to complete
      await waitFor(() => {
        expect(deviceService.detectDevices).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Race Condition Prevention', () => {
    it('refresh shows latest detection results', async () => {
      // Initial call returns Device A
      const deviceA = createMockDevice({ path: '/dev/cu.usbmodemA', label: 'Device A' });
      vi.mocked(deviceService.detectDevices).mockResolvedValueOnce([deviceA]);

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      // Wait for initial detection
      await waitFor(() => {
        expect(screen.getByText('Device A')).toBeInTheDocument();
      });

      // Setup second call to return Device B
      const deviceB = createMockDevice({ path: '/dev/cu.usbmodemB', label: 'Device B' });
      vi.mocked(deviceService.detectDevices).mockResolvedValueOnce([deviceB]);

      // Click refresh
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      });

      // Latest result should be shown, not stale data
      await waitFor(() => {
        expect(screen.getByText('Device B')).toBeInTheDocument();
      });
      expect(screen.queryByText('Device A')).not.toBeInTheDocument();
      expect(deviceService.detectDevices).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('handles detection error gracefully', async () => {
      vi.mocked(deviceService.detectDevices).mockRejectedValue(
        new Error('Detection failed')
      );

      render(
        <DeviceSelection
          selectedDevices={[]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      // Should not crash - shows no devices found
      await waitFor(() => {
        expect(screen.getByText('No BlueBuzzah Devices Found')).toBeInTheDocument();
      });
    });
  });

  describe('Device Info Card', () => {
    it('shows device roles info card', async () => {
      const mockDevice = createMockDevice();
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[mockDevice]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Device Roles')).toBeInTheDocument();
      });
    });

    it('shows message for single device selection', async () => {
      const mockDevice = createMockDevice();
      vi.mocked(deviceService.detectDevices).mockResolvedValue([mockDevice]);

      render(
        <DeviceSelection
          selectedDevices={[mockDevice]}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Please select a role for your device.')).toBeInTheDocument();
      });
    });

    it('shows auto-assigned message for two devices', async () => {
      const mockDevices = createMockDevices(2);
      mockDevices[0].role = 'PRIMARY';
      mockDevices[1].role = 'SECONDARY';
      vi.mocked(deviceService.detectDevices).mockResolvedValue(mockDevices);

      render(
        <DeviceSelection
          selectedDevices={mockDevices}
          onDevicesChange={mockOnDevicesChange}
          onRoleChange={mockOnRoleChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Roles have been auto-assigned. You can change them if needed.')).toBeInTheDocument();
      });
    });
  });
});
