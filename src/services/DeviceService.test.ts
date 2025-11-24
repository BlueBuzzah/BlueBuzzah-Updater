import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { DeviceService } from './DeviceService';
import {
  createMockDevice,
  createMockBundle,
  createMockValidation,
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
    it('returns array of detected devices', async () => {
      const mockDevices = [
        { path: '/Volumes/CIRCUITPY', label: 'CIRCUITPY', is_circuit_py: true },
        { path: '/Volumes/BLUEBUZZAH', label: 'BLUEBUZZAH', is_circuit_py: true },
      ];

      vi.mocked(invoke).mockResolvedValueOnce(mockDevices);

      const devices = await service.detectDevices();

      expect(devices).toHaveLength(2);
      expect(invoke).toHaveBeenCalledWith('detect_devices');
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
    it('returns valid result for good device', async () => {
      const device = createMockDevice();
      const mockValidation = {
        valid: true,
        errors: [],
        warnings: [],
        available_space_mb: 100,
        required_space_mb: 10,
      };

      vi.mocked(invoke).mockResolvedValueOnce(mockValidation);

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.availableSpaceMB).toBe(100);
      expect(invoke).toHaveBeenCalledWith('validate_device', { devicePath: device.path });
    });

    it('returns errors for missing device', async () => {
      const device = createMockDevice();
      const mockValidation = {
        valid: false,
        errors: ['Device not found'],
        warnings: [],
      };

      vi.mocked(invoke).mockResolvedValueOnce(mockValidation);

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Device not found');
    });

    it('returns errors for not writable', async () => {
      const device = createMockDevice();
      const mockValidation = {
        valid: false,
        errors: ['Device is not writable'],
        warnings: [],
      };

      vi.mocked(invoke).mockResolvedValueOnce(mockValidation);

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Device is not writable');
    });

    it('returns errors for insufficient space', async () => {
      const device = createMockDevice();
      const mockValidation = {
        valid: false,
        errors: ['Insufficient disk space'],
        warnings: [],
        available_space_mb: 5,
        required_space_mb: 10,
      };

      vi.mocked(invoke).mockResolvedValueOnce(mockValidation);

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Insufficient disk space');
      expect(result.availableSpaceMB).toBe(5);
      expect(result.requiredSpaceMB).toBe(10);
    });

    it('returns warnings for low space', async () => {
      const device = createMockDevice();
      const mockValidation = {
        valid: true,
        errors: [],
        warnings: ['Low disk space'],
        available_space_mb: 15,
        required_space_mb: 10,
      };

      vi.mocked(invoke).mockResolvedValueOnce(mockValidation);

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Low disk space');
    });

    it('returns warnings for missing boot_out.txt', async () => {
      const device = createMockDevice();
      const mockValidation = {
        valid: true,
        errors: [],
        warnings: ['boot_out.txt not found'],
      };

      vi.mocked(invoke).mockResolvedValueOnce(mockValidation);

      const result = await service.validateDevice(device);

      expect(result.warnings).toContain('boot_out.txt not found');
    });

    it('handles validation error gracefully', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockRejectedValueOnce(new Error('Validation error'));

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Validation failed: Validation error');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to validate device:',
        expect.any(Error)
      );
    });

    it('handles string error from Tauri', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockRejectedValueOnce('Timeout');

      const result = await service.validateDevice(device);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Validation failed: Timeout');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to validate device:',
        'Timeout'
      );
    });
  });

  describe('validateDevices', () => {
    it('validates multiple devices in parallel', async () => {
      const devices = [
        createMockDevice({ path: '/Volumes/CIRCUITPY1' }),
        createMockDevice({ path: '/Volumes/CIRCUITPY2' }),
      ];

      vi.mocked(invoke)
        .mockResolvedValueOnce({ valid: true, errors: [], warnings: [] })
        .mockResolvedValueOnce({ valid: true, errors: [], warnings: [] });

      const results = await service.validateDevices(devices);

      expect(results.size).toBe(2);
      expect(results.get('/Volumes/CIRCUITPY1')?.valid).toBe(true);
      expect(results.get('/Volumes/CIRCUITPY2')?.valid).toBe(true);
    });

    it('returns mixed results for devices with different states', async () => {
      const devices = [
        createMockDevice({ path: '/Volumes/GOOD' }),
        createMockDevice({ path: '/Volumes/BAD' }),
      ];

      vi.mocked(invoke)
        .mockResolvedValueOnce({ valid: true, errors: [], warnings: [] })
        .mockResolvedValueOnce({ valid: false, errors: ['Not writable'], warnings: [] });

      const results = await service.validateDevices(devices);

      expect(results.get('/Volumes/GOOD')?.valid).toBe(true);
      expect(results.get('/Volumes/BAD')?.valid).toBe(false);
    });
  });

  describe('wipeDevice', () => {
    it('calls wipe_device command', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.wipeDevice(device);

      expect(invoke).toHaveBeenCalledWith('wipe_device', { devicePath: device.path });
    });

    it('handles wipe failure', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockRejectedValueOnce(new Error('Wipe failed'));

      await expect(service.wipeDevice(device)).rejects.toThrow('Failed to wipe device');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to wipe device:',
        expect.any(Error)
      );
    });

    it('handles string error from Tauri', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockRejectedValueOnce('Device disconnected');

      await expect(service.wipeDevice(device)).rejects.toThrow(
        'Failed to wipe device: Device disconnected'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to wipe device:',
        'Device disconnected'
      );
    });
  });

  describe('renameVolume', () => {
    it('calls rename_volume command', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.renameVolume(device, 'BLUEBUZZAH');

      expect(invoke).toHaveBeenCalledWith('rename_volume', {
        devicePath: device.path,
        newName: 'BLUEBUZZAH',
      });
    });

    it('handles rename success', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await expect(service.renameVolume(device, 'NEWNAME')).resolves.toBeUndefined();
    });

    it('handles rename failure', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockRejectedValueOnce(new Error('Rename failed'));

      await expect(service.renameVolume(device, 'BLUEBUZZAH')).rejects.toThrow(
        'Failed to rename volume'
      );
    });

    it('handles permission denied', async () => {
      const device = createMockDevice();

      vi.mocked(invoke).mockRejectedValueOnce('Permission denied');

      await expect(service.renameVolume(device, 'BLUEBUZZAH')).rejects.toThrow(
        'Failed to rename volume: Permission denied'
      );
    });
  });

  describe('deployFirmware', () => {
    it('calls all deployment steps in order', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();

      // Mock all invoke calls in order
      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined) // copy_firmware
        .mockResolvedValueOnce(undefined) // write_config
        .mockResolvedValueOnce(undefined) // rename_volume
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH'); // find_renamed_volume

      await service.deployFirmware(device, firmware);

      expect(invoke).toHaveBeenCalledWith('wipe_device', { devicePath: device.path });
      expect(invoke).toHaveBeenCalledWith('copy_firmware', expect.any(Object));
      expect(invoke).toHaveBeenCalledWith('write_config', expect.any(Object));
    });

    it('reports progress via callback', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined) // copy_firmware
        .mockResolvedValueOnce(undefined) // write_config
        .mockResolvedValueOnce(undefined) // rename_volume
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH'); // find_renamed_volume

      await service.deployFirmware(device, firmware, progressCallback);

      // Should report wiping, copying, configuring, and complete stages
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'wiping' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'copying' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'configuring' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'complete', progress: 100 })
      );
    });

    it('throws error if device role not set', async () => {
      const device = createMockDevice({ role: undefined });
      const firmware = createMockBundle();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined); // copy_firmware

      await expect(service.deployFirmware(device, firmware)).rejects.toThrow(
        'Device role not set'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to deploy firmware:',
        expect.any(Error)
      );
    });

    it('handles wipe failure during deployment', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke).mockRejectedValueOnce(new Error('Wipe failed'));

      await expect(
        service.deployFirmware(device, firmware, progressCallback)
      ).rejects.toThrow();

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'error' })
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to wipe device:',
        expect.any(Error)
      );
    });

    it('handles copy failure during deployment', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockRejectedValueOnce(new Error('Copy failed')); // copy_firmware

      await expect(
        service.deployFirmware(device, firmware, progressCallback)
      ).rejects.toThrow();

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'error' })
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to deploy firmware:',
        expect.any(Error)
      );
    });

    it('continues if volume rename fails (non-critical)', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined) // copy_firmware
        .mockResolvedValueOnce(undefined) // write_config
        .mockRejectedValueOnce(new Error('Rename failed')); // rename_volume

      // Should not throw - rename failure is non-critical
      await service.deployFirmware(device, firmware, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'complete' })
      );
      expect(mockConsole.warn).toHaveBeenCalledWith(
        'Volume rename failed (non-critical):',
        expect.any(Error)
      );
    });

    it('reports new device path after rename', async () => {
      const device = createMockDevice({ role: 'SECONDARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined) // copy_firmware
        .mockResolvedValueOnce(undefined) // write_config
        .mockResolvedValueOnce(undefined) // rename_volume
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH'); // find_renamed_volume

      await service.deployFirmware(device, firmware, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          newDeviceLabel: 'BLUEBUZZAH',
          newDevicePath: '/Volumes/BLUEBUZZAH',
        })
      );
    });

    it('handles numbered volume name after rename', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined) // copy_firmware
        .mockResolvedValueOnce(undefined) // write_config
        .mockResolvedValueOnce(undefined) // rename_volume
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH 1'); // find_renamed_volume

      await service.deployFirmware(device, firmware, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          newDeviceLabel: 'BLUEBUZZAH 1',
          newDevicePath: '/Volumes/BLUEBUZZAH 1',
        })
      );
    });

    it('writes correct config for PRIMARY role', async () => {
      const device = createMockDevice({ role: 'PRIMARY' });
      const firmware = createMockBundle();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined) // copy_firmware
        .mockResolvedValueOnce(undefined) // write_config
        .mockResolvedValueOnce(undefined) // rename_volume
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH'); // find_renamed_volume

      await service.deployFirmware(device, firmware);

      expect(invoke).toHaveBeenCalledWith('write_config', {
        devicePath: device.path,
        role: 'PRIMARY',
        configContent: expect.stringContaining('DEVICE_ROLE = "PRIMARY"'),
      });
    });

    it('writes correct config for SECONDARY role', async () => {
      const device = createMockDevice({ role: 'SECONDARY' });
      const firmware = createMockBundle();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe_device
        .mockResolvedValueOnce(undefined) // copy_firmware
        .mockResolvedValueOnce(undefined) // write_config
        .mockResolvedValueOnce(undefined) // rename_volume
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH'); // find_renamed_volume

      await service.deployFirmware(device, firmware);

      expect(invoke).toHaveBeenCalledWith('write_config', {
        devicePath: device.path,
        role: 'SECONDARY',
        configContent: expect.stringContaining('DEVICE_ROLE = "SECONDARY"'),
      });
    });
  });

  describe('performBatchUpdate', () => {
    it('updates all devices and returns success result', async () => {
      const devices = [
        createMockDevice({ path: '/Volumes/CIRCUITPY1', role: 'PRIMARY' }),
        createMockDevice({ path: '/Volumes/CIRCUITPY2', role: 'SECONDARY' }),
      ];
      const firmware = createMockBundle();

      // Mock successful deployment for both devices
      vi.mocked(invoke)
        // Device 1
        .mockResolvedValueOnce(undefined) // wipe
        .mockResolvedValueOnce(undefined) // copy
        .mockResolvedValueOnce(undefined) // config
        .mockResolvedValueOnce(undefined) // rename
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH') // find
        // Device 2
        .mockResolvedValueOnce(undefined) // wipe
        .mockResolvedValueOnce(undefined) // copy
        .mockResolvedValueOnce(undefined) // config
        .mockResolvedValueOnce(undefined) // rename
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH 1'); // find

      const result = await service.performBatchUpdate(devices, firmware);

      expect(result.success).toBe(true);
      expect(result.message).toBe('All devices updated successfully');
      expect(result.deviceUpdates).toHaveLength(2);
      expect(result.deviceUpdates[0].success).toBe(true);
      expect(result.deviceUpdates[1].success).toBe(true);
    });

    it('returns partial failure when some devices fail', async () => {
      const devices = [
        createMockDevice({ path: '/Volumes/CIRCUITPY1', role: 'PRIMARY' }),
        createMockDevice({ path: '/Volumes/CIRCUITPY2', role: 'SECONDARY' }),
      ];
      const firmware = createMockBundle();

      // First device succeeds, second fails
      vi.mocked(invoke)
        // Device 1 - success
        .mockResolvedValueOnce(undefined) // wipe
        .mockResolvedValueOnce(undefined) // copy
        .mockResolvedValueOnce(undefined) // config
        .mockResolvedValueOnce(undefined) // rename
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH') // find
        // Device 2 - fails on wipe
        .mockRejectedValueOnce(new Error('Device disconnected'));

      const result = await service.performBatchUpdate(devices, firmware);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Some devices failed to update');
      expect(result.deviceUpdates[0].success).toBe(true);
      expect(result.deviceUpdates[1].success).toBe(false);
      expect(result.deviceUpdates[1].error).toContain('Device disconnected');
      // Should log the wipe failure and deploy failure
      expect(mockConsole.error).toHaveBeenCalled();
    });

    it('reports progress for each device', async () => {
      const devices = [createMockDevice({ path: '/Volumes/CIRCUITPY', role: 'PRIMARY' })];
      const firmware = createMockBundle();
      const progressCallback = vi.fn();

      vi.mocked(invoke)
        .mockResolvedValueOnce(undefined) // wipe
        .mockResolvedValueOnce(undefined) // copy
        .mockResolvedValueOnce(undefined) // config
        .mockResolvedValueOnce(undefined) // rename
        .mockResolvedValueOnce('/Volumes/BLUEBUZZAH'); // find

      await service.performBatchUpdate(devices, firmware, progressCallback);

      expect(progressCallback).toHaveBeenCalled();
    });
  });
});
