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
import { createProgressThrottle } from '@/lib/throttle';

export interface IDeviceRepository {
  detectDevices(): Promise<Device[]>;
  deployFirmware(
    device: Device,
    firmware: FirmwareBundle,
    onProgress?: (progress: UpdateProgress) => void,
    onLog?: (message: string) => void
  ): Promise<string[]>;
  validateDevice(device: Device): Promise<ValidationResult>;
  validateDevices(devices: Device[]): Promise<Map<string, ValidationResult>>;
  cancelFlash(): Promise<void>;
}

// How long to wait after the flash command resolves for the channel to deliver
// the backend's last stage. Channel events can land after the command's result.
const CHANNEL_SETTLE_MS = 2000;

// Map DFU stages to UpdateStage enum (returns null for log and warning events)
function mapDfuStageToUpdateStage(dfuStage: string): UpdateStage | null {
  switch (dfuStage) {
    case 'reading':
    case 'detected':
    case 'bootloader':
    case 'waiting':
    case 'connecting':
    case 'init':
    case 'starting':
    case 'retrying': // Retry attempts show as preparing (restart process)
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
    case 'cancelled':
      return 'cancelled';
    case 'log':
    case 'warning':
      return null; // Log and warning events don't change the stage
    default:
      return 'copying';
  }
}

// Generate stable display messages per stage (not raw backend messages)
function getStageDisplayMessage(stage: UpdateStage, dfuProgress: DfuProgress): string {
  switch (stage) {
    case 'preparing':
      return 'Preparing device for update...';
    case 'copying':
      return 'Uploading firmware...';
    case 'validating':
      return 'Validating firmware...';
    case 'configuring':
      return 'Configuring device...';
    case 'complete':
      return 'Update complete';
    case 'error':
    case 'cancelled':
      return dfuProgress.message;
    default:
      return dfuProgress.message;
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
        board: string;
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
        // Unknown backend board strings intentionally fall back to 'nrf52'
        // today; a THIRD board must make this an exhaustive mapping or it
        // will be flashed with the wrong protocol.
        board: d.board === 'esp32s3' ? 'esp32s3' : 'nrf52',
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

  /**
   * Flash one device. Resolves with the warnings it reported after a successful
   * flash (boot faults, role not set); empty when there were none.
   */
  async deployFirmware(
    device: Device,
    firmware: FirmwareBundle,
    onProgress?: (progress: UpdateProgress) => void,
    onLog?: (message: string) => void
  ): Promise<string[]> {
    // Create throttled progress callback (100ms interval, 1% minimum change)
    const throttledProgress = onProgress
      ? createProgressThrottle(onProgress, 100, 1)
      : null;
    const warnings: string[] = [];

    try {
      // Validate device role
      if (!device.role) {
        throw new Error('Device role not set');
      }

      // Initial progress (sent immediately, not throttled)
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
      // Resolves once the backend's last stage (complete or cancelled) arrives.
      let channelSettled = () => {};
      const settled = new Promise<void>((resolve) => {
        channelSettled = resolve;
      });

      progressChannel.onmessage = (dfuProgress) => {
        const mappedStage = mapDfuStageToUpdateStage(dfuProgress.stage);

        // Log events go to the log callback; warnings are collected and logged
        // by the caller. Neither changes the progress display.
        if (mappedStage === null) {
          if (dfuProgress.stage === 'warning') warnings.push(dfuProgress.message);
          else onLog?.(dfuProgress.message);
          return;
        }
        if (mappedStage === 'complete' || mappedStage === 'cancelled') channelSettled();

        // Non-log events: emit throttled progress with stable display message
        const displayMessage = getStageDisplayMessage(mappedStage, dfuProgress);

        throttledProgress?.({
          devicePath: device.path,
          stage: mappedStage,
          progress: dfuProgress.percent,
          message: displayMessage,
          currentFile:
            dfuProgress.stage === 'uploading' &&
            dfuProgress.sent !== undefined &&
            dfuProgress.total !== undefined
              ? `${Math.round(dfuProgress.sent / 1024)}KB / ${Math.round(dfuProgress.total / 1024)}KB`
              : undefined,
        });
      };

      // Call the flash command matching this device's hardware family
      const command =
        device.board === 'esp32s3' ? 'flash_v3_firmware' : 'flash_dfu_firmware';
      await invoke(command, {
        serialPort: device.path,
        firmwarePath: firmware.localPath,
        deviceRole: device.role,
        progress: progressChannel,
      });

      // Don't return before late warnings arrive; a missing last stage only
      // costs the short fallback.
      let fallback: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        settled,
        new Promise<void>((resolve) => {
          fallback = setTimeout(resolve, CHANNEL_SETTLE_MS);
        }),
      ]);
      clearTimeout(fallback);

      // Flush any pending throttled updates before final complete
      throttledProgress?.flush();

      // Final complete progress (sent immediately, not throttled)
      if (onProgress) {
        onProgress({
          devicePath: device.path,
          stage: 'complete',
          progress: 100,
          message: 'Update complete',
        });
      }
      return warnings;
    } catch (error) {
      // The caller only logs warnings from a finished flash: log them here so
      // a failed or stopped run keeps the fault lines.
      warnings.forEach((warning) => onLog?.(warning));
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
        const warnings = await this.deployFirmware(device, firmware, onProgress);
        results.push({
          device,
          success: true,
          warnings,
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

  /**
   * Cancel any in-progress firmware flash operation.
   * Sets a global cancellation flag that is checked during the DFU process.
   */
  async cancelFlash(): Promise<void> {
    try {
      await invoke('cancel_dfu_flash');
    } catch (error) {
      console.error('Failed to cancel flash:', error);
      throw error;
    }
  }
}

// Singleton instance
export const deviceService = new DeviceService();
