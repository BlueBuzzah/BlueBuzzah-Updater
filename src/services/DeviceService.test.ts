import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { DeviceService } from './DeviceService';
import {
  createMockDevice,
  createMockBundle,
} from '@/test/factories';
import { mockConsole } from '@/test/setup';

// Note: Tauri API is mocked in test/setup.ts

describe('DeviceService', () => {
  let service: DeviceService;

  beforeEach(() => {
    service = new DeviceService();
    vi.resetAllMocks();
  });

  describe('detectDevices', () => {
    it('returns array of detected DFU devices', async () => {
      const mockDevices = [
        {
          port: '/dev/cu.usbmodem1234',
          label: 'Feather nRF52840 (App)',
          vid: 0x239a,
          pid: 0x8029,
          in_bootloader: false,
          serial_number: 'ABC123',
        },
        {
          port: '/dev/cu.usbmodem5678',
          label: 'Feather nRF52840 (Bootloader)',
          vid: 0x239a,
          pid: 0x0029,
          in_bootloader: true,
          serial_number: null,
        },
      ];

      vi.mocked(invoke).mockResolvedValueOnce(mockDevices);

      const devices = await service.detectDevices();

      expect(devices).toHaveLength(2);
      expect(devices[0].path).toBe('/dev/cu.usbmodem1234');
      expect(devices[0].vid).toBe(0x239a);
      expect(devices[0].inBootloader).toBe(false);
      expect(devices[1].inBootloader).toBe(true);
      expect(invoke).toHaveBeenCalledWith('detect_dfu_devices');
    });

    it('returns empty array when no devices', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      const devices = await service.detectDevices();

      expect(devices).toEqual([]);
    });

    it('handles detection error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Detection failed'));

      await expect(service.detectDevices()).rejects.toThrow('Failed to detect devices');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to detect devices:',
        expect.any(Error)
      );
    });

    it('handles string error from Tauri', async () => {
      vi.mocked(invoke).mockRejectedValueOnce('Permission denied');

      await expect(service.detectDevices()).rejects.toThrow(
        'Failed to detect devices: Permission denied'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to detect devices:',
        'Permission denied'
      );
    });
  });

  describe('validateDevice', () => {
    it('returns valid result for application mode device', async () => {
      const device = createMockDevice({ inBootloader: false });

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns valid result for device in bootloader mode (now supported)', async () => {
      const device = createMockDevice({ inBootloader: true });

      const result = await service.validateDevice(device);

      // Bootloader mode devices are now supported - protocol auto-detects and handles them
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('returns error for device without path', async () => {
      const device = createMockDevice({ path: '' });

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Device path is missing');
    });
  });

  describe('validateDevices', () => {
    it('validates multiple devices in parallel', async () => {
      const devices = [
        createMockDevice({ path: '/dev/cu.usbmodem1', inBootloader: false }),
        createMockDevice({ path: '/dev/cu.usbmodem2', inBootloader: false }),
      ];

      const results = await service.validateDevices(devices);

      expect(results.size).toBe(2);
      expect(results.get('/dev/cu.usbmodem1')?.valid).toBe(true);
      expect(results.get('/dev/cu.usbmodem2')?.valid).toBe(true);
    });

    it('returns valid results for devices in both application and bootloader mode', async () => {
      const devices = [
        createMockDevice({ path: '/dev/cu.usbmodem1', inBootloader: false }),
        createMockDevice({ path: '/dev/cu.usbmodem2', inBootloader: true }),
      ];

      const results = await service.validateDevices(devices);

      // Both should be valid - bootloader mode is now supported
      expect(results.get('/dev/cu.usbmodem1')?.valid).toBe(true);
      expect(results.get('/dev/cu.usbmodem2')?.valid).toBe(true);
    });
  });

  describe('deployFirmware', () => {
    it('throws error if device role not set', async () => {
      const device = createMockDevice({ role: undefined });
      const firmware = createMockBundle();

      await expect(service.deployFirmware(device, firmware)).rejects.toThrow(
        'Device role not set'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to deploy firmware:',
        expect.any(Error)
      );
    });

    it('reports initial progress', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      // Mock invoke to fail immediately so we can check initial progress
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Test error'));

      await expect(
        service.deployFirmware(device, firmware, progressCallback)
      ).rejects.toThrow();

      // Should report initial preparing stage
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'preparing',
          progress: 0,
          message: 'Preparing device for update...',
        })
      );
    });

    it('reports error stage on failure', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke).mockRejectedValueOnce(new Error('DFU failed'));

      await expect(
        service.deployFirmware(device, firmware, progressCallback)
      ).rejects.toThrow();

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'error' })
      );
    });

    it('calls flash_dfu_firmware with correct parameters', async () => {
      const device = createMockDevice({ role: 'PRIMARY', path: '/dev/cu.usbmodem1234' });
      const firmware = createMockBundle({ localPath: '/tmp/firmware.zip' });

      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.deployFirmware(device, firmware);

      expect(invoke).toHaveBeenCalledWith('flash_dfu_firmware', {
        serialPort: '/dev/cu.usbmodem1234',
        firmwarePath: '/tmp/firmware.zip',
        deviceRole: 'PRIMARY',
        progress: expect.any(Object),
      });
    });

    it('reports complete stage on success', async () => {
      const device = createMockDevice({ role: 'SECONDARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.deployFirmware(device, firmware, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'complete',
          progress: 100,
          message: 'Update complete!',
        })
      );
    });
  });

  describe('performBatchUpdate', () => {
    it('updates all devices and returns success result', async () => {
      const devices = [
        createMockDevice({ path: '/dev/cu.usbmodem1', role: 'PRIMARY' }),
        createMockDevice({ path: '/dev/cu.usbmodem2', role: 'SECONDARY' }),
      ];
      const firmware = createMockBundle();

      // Mock successful deployment for both devices
      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // Device 1
        .mockResolvedValueOnce(undefined); // Device 2

      const result = await service.performBatchUpdate(devices, firmware);

      expect(result.success).toBe(true);
      expect(result.message).toBe('All devices updated successfully');
      expect(result.deviceUpdates).toHaveLength(2);
      expect(result.deviceUpdates[0].success).toBe(true);
      expect(result.deviceUpdates[1].success).toBe(true);
    });

    it('returns partial failure when some devices fail', async () => {
      const devices = [
        createMockDevice({ path: '/dev/cu.usbmodem1', role: 'PRIMARY' }),
        createMockDevice({ path: '/dev/cu.usbmodem2', role: 'SECONDARY' }),
      ];
      const firmware = createMockBundle();

      // First device succeeds, second fails
      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // Device 1 - success
        .mockRejectedValueOnce(new Error('Device disconnected')); // Device 2 - fails

      const result = await service.performBatchUpdate(devices, firmware);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Some devices failed to update');
      expect(result.deviceUpdates[0].success).toBe(true);
      expect(result.deviceUpdates[1].success).toBe(false);
      expect(result.deviceUpdates[1].error).toContain('Device disconnected');
    });

    it('reports progress for each device', async () => {
      const devices = [createMockDevice({ path: '/dev/cu.usbmodem1', role: 'PRIMARY' })];
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.performBatchUpdate(devices, firmware, progressCallback);

      expect(progressCallback).toHaveBeenCalled();
    });
  });
});
