import { invoke, Channel } from '@tauri-apps/api/core';
import {
  Device,
  FirmwareBundle,
  UpdateResult,
  DeviceUpdateResult,
  UpdateProgress,
  ValidationResult,
} from '@/types';
import { getConfigForRole } from '@/lib/config-templates';

export interface IDeviceRepository {
  detectDevices(): Promise<Device[]>;
  deployFirmware(
    device: Device,
    firmware: FirmwareBundle,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<void>;
  wipeDevice(device: Device): Promise<void>;
  validateDevice(device: Device): Promise<ValidationResult>;
  validateDevices(devices: Device[]): Promise<Map<string, ValidationResult>>;
}

export class DeviceService implements IDeviceRepository {
  async detectDevices(): Promise<Device[]> {
    try {
      const devices = await invoke<Device[]>('detect_devices');
      return devices;
    } catch (error) {
      console.error('Failed to detect devices:', error);
      // Tauri errors are often plain strings, not Error objects
      const errorMessage = typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : JSON.stringify(error);
      throw new Error(`Failed to detect devices: ${errorMessage}`);
    }
  }

  async deployFirmware(
    device: Device,
    firmware: FirmwareBundle,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<void> {
    try {
      // Step 1: Wipe device
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'wiping',
          progress: 0,
          message: 'Wiping device...',
        });
      }

      await this.wipeDevice(device);

      // Step 2: Copy firmware
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'copying',
          progress: 0,
          message: 'Copying firmware files...',
        });
      }

      // Create a channel to receive progress updates
      const progressChannel = new Channel<{
        current_file: string;
        total_files: number;
        completed_files: number;
      }>();

      progressChannel.onmessage = (message) => {
        if (onProgress) {
          const progress = (message.completed_files / message.total_files) * 100;
          onProgress({
            devicePath: device.path,
            stage: 'copying',
            currentFile: message.current_file,
            progress,
            message: `Copying ${message.current_file}...`,
          });
        }
      };

      await invoke('copy_firmware', {
        firmwarePath: firmware.localPath,
        devicePath: device.path,
        progressCallback: progressChannel,
      });

      // Step 3: Write config
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'configuring',
          progress: 90,
          message: 'Writing configuration...',
        });
      }

      if (!device.role) {
        throw new Error('Device role not set');
      }

      const configContent = getConfigForRole(device.role);

      await invoke('write_config', {
        devicePath: device.path,
        role: device.role,
        configContent,
      });

      // Step 4: Complete
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'complete',
          progress: 100,
          message: 'Update complete!',
        });
      }
    } catch (error) {
      console.error('Failed to deploy firmware:', error);
      const errorMessage = typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : JSON.stringify(error);
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'error',
          progress: 0,
          message: `Error: ${errorMessage}`,
        });
      }
      throw error;
    }
  }

  async wipeDevice(device: Device): Promise<void> {
    try {
      await invoke('wipe_device', {
        devicePath: device.path,
      });
    } catch (error) {
      console.error('Failed to wipe device:', error);
      // Tauri errors are often plain strings, not Error objects
      const errorMessage = typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : JSON.stringify(error);
      throw new Error(`Failed to wipe device: ${errorMessage}`);
    }
  }

  async validateDevice(device: Device): Promise<ValidationResult> {
    try {
      const result = await invoke<{
        valid: boolean;
        errors: string[];
        warnings: string[];
        available_space_mb?: number;
        required_space_mb?: number;
      }>('validate_device', {
        devicePath: device.path,
      });

      return {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        availableSpaceMB: result.available_space_mb,
        requiredSpaceMB: result.required_space_mb,
      };
    } catch (error) {
      console.error('Failed to validate device:', error);
      // Return invalid result on error
      const errorMessage = typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : JSON.stringify(error);
      return {
        valid: false,
        errors: [`Validation failed: ${errorMessage}`],
        warnings: [],
      };
    }
  }

  async validateDevices(devices: Device[]): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();

    // Validate all devices in parallel
    const validationPromises = devices.map(async (device) => {
      const result = await this.validateDevice(device);
      results.set(device.path, result);
    });

    await Promise.all(validationPromises);
    return results;
  }

  async performBatchUpdate(
    devices: Device[],
    firmware: FirmwareBundle,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<UpdateResult> {
    const results: DeviceUpdateResult[] = [];

    for (const device of devices) {
      try {
        await this.deployFirmware(device, firmware, onProgress);
        results.push({
          device,
          success: true,
        });
      } catch (error) {
        results.push({
          device,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const success = results.every((r) => r.success);

    return {
      success,
      message: success
        ? 'All devices updated successfully'
        : 'Some devices failed to update',
      deviceUpdates: results,
    };
  }
}

// Singleton instance
export const deviceService = new DeviceService();
