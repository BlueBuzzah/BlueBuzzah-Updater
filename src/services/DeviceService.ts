import {
  Device,
  DeviceUpdateResult,
  DfuProgress,
  FirmwareBundle,
  UpdateProgress,
  UpdateResult,
  UpdateStage,
  ValidationResult,
} from '@/types';
import { Channel, invoke } from '@tauri-apps/api/core';

export interface IDeviceRepository {
  detectDevices(): Promise<Device[]>;
  deployFirmware(
    device: Device,
    firmware: FirmwareBundle,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<void>;
  validateDevice(device: Device): Promise<ValidationResult>;
  validateDevices(devices: Device[]): Promise<Map<string, ValidationResult>>;
}

// Map DFU stages to UpdateStage enum (returns null for log events)
function mapDfuStageToUpdateStage(dfuStage: string): UpdateStage | null {
  switch (dfuStage) {
    case 'reading':
    case 'detected':
    case 'bootloader':
    case 'waiting':
    case 'connecting':
    case 'init':
    case 'starting':
      return 'preparing'; // Pre-transfer phases (bootloader entry)
    case 'uploading':
      return 'copying'; // Main transfer phase
    case 'validating':
      return 'validating';
    case 'activating':
    case 'rebooting':
    case 'configuring':
      return 'configuring'; // Post-transfer phases
    case 'complete':
      return 'complete';
    case 'log':
      return null; // Log events don't change the stage
    default:
      return 'copying';
  }
}

export class DeviceService implements IDeviceRepository {
  async detectDevices(): Promise<Device[]> {
    try {
      // Call the new DFU device detection command
      const dfuDevices = await invoke<{
        port: string;
        label: string;
        vid: number;
        pid: number;
        in_bootloader: boolean;
        serial_number: string | null;
      }[]>('detect_dfu_devices');

      // Map to Device interface
      return dfuDevices.map((d) => ({
        path: d.port,
        label: d.label,
        isCircuitPy: false, // DFU devices are not CircuitPython
        vid: d.vid,
        pid: d.pid,
        inBootloader: d.in_bootloader,
        serialNumber: d.serial_number ?? undefined,
      }));
    } catch (error) {
      console.error('Failed to detect devices:', error);
      const errorMessage =
        typeof error === 'string'
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
      // Validate device role
      if (!device.role) {
        throw new Error('Device role not set');
      }

      // Initial progress
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'preparing',
          progress: 0,
          message: 'Preparing device for update...',
        });
      }

      // Create a channel to receive DFU progress updates
      const progressChannel = new Channel<DfuProgress>();

      // Track last known progress values for log events
      let lastStage: UpdateStage = 'preparing';
      let lastProgress = 0;

      progressChannel.onmessage = (dfuProgress) => {
        if (onProgress) {
          const mappedStage = mapDfuStageToUpdateStage(dfuProgress.stage);

          // Log events only update the message, not the stage or progress
          if (mappedStage === null) {
            onProgress({
              devicePath: device.path,
              stage: lastStage,
              progress: lastProgress,
              message: dfuProgress.message,
            });
          } else {
            // Update tracking for non-log events
            lastStage = mappedStage;
            lastProgress = dfuProgress.percent;

            onProgress({
              devicePath: device.path,
              stage: mappedStage,
              progress: dfuProgress.percent,
              message: dfuProgress.message,
              currentFile:
                dfuProgress.sent !== undefined && dfuProgress.total !== undefined
                  ? `${Math.round((dfuProgress.sent / 1024))}KB / ${Math.round((dfuProgress.total / 1024))}KB`
                  : undefined,
            });
          }
        }
      };

      // Call the DFU flash command
      await invoke('flash_dfu_firmware', {
        serialPort: device.path,
        firmwarePath: firmware.localPath,
        deviceRole: device.role,
        progress: progressChannel,
      });

      // Final complete progress
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
      const errorMessage =
        typeof error === 'string'
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

  async validateDevice(device: Device): Promise<ValidationResult> {
    // For DFU devices, validation is simpler - just check if the device is accessible
    // Note: Bootloader mode devices are now supported - the protocol auto-detects and handles them
    try {
      // Basic validation - device exists and has required fields
      if (!device.path) {
        return {
          valid: false,
          errors: ['Device path is missing'],
          warnings: [],
        };
      }

      return {
        valid: true,
        errors: [],
        warnings: [],
      };
    } catch (error) {
      console.error('Failed to validate device:', error);
      const errorMessage =
        typeof error === 'string'
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

  async validateDevices(
    devices: Device[]
  ): Promise<Map<string, ValidationResult>> {
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
