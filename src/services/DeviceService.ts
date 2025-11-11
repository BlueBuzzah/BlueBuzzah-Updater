import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Device,
  FirmwareBundle,
  UpdateResult,
  DeviceUpdateResult,
  UpdateProgress,
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
}

export class DeviceService implements IDeviceRepository {
  async detectDevices(): Promise<Device[]> {
    try {
      const devices = await invoke<Device[]>('detect_devices');
      return devices;
    } catch (error) {
      console.error('Failed to detect devices:', error);
      throw new Error(
        `Failed to detect devices: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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

      // Set up progress listener
      const unlisten = await listen<{
        current_file: string;
        total_files: number;
        completed_files: number;
      }>('copy-progress', (event) => {
        if (onProgress) {
          const progress =
            (event.payload.completed_files / event.payload.total_files) * 100;
          onProgress({
            devicePath: device.path,
            stage: 'copying',
            currentFile: event.payload.current_file,
            progress,
            message: `Copying ${event.payload.current_file}...`,
          });
        }
      });

      await invoke('copy_firmware', {
        firmwarePath: firmware.localPath,
        devicePath: device.path,
      });

      unlisten();

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
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'error',
          progress: 0,
          message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      throw new Error(
        `Failed to wipe device: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
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
