// Error message mapping and troubleshooting guidance

export interface ErrorGuidance {
  title: string;
  description: string;
  resolutionSteps: string[];
}

export const ERROR_GUIDANCE: Record<string, ErrorGuidance> = {
  DEVICE_NOT_FOUND: {
    title: 'Device Not Found',
    description: 'The selected device is no longer connected or accessible.',
    resolutionSteps: [
      'Check that the device is properly connected via USB',
      'Ensure the device is mounted and visible in your file manager',
      'Try unplugging and reconnecting the device',
      'Click "Refresh" to detect devices again',
    ],
  },
  DEVICE_NOT_WRITABLE: {
    title: 'Device Not Writable',
    description: 'Cannot write to the device due to permissions or write protection.',
    resolutionSteps: [
      'Check if the device has a physical write-protect switch',
      'macOS: Grant Full Disk Access in System Settings → Privacy & Security → Full Disk Access',
      'Windows: Ensure no other application is accessing the device',
      'Ensure the device is not mounted as read-only',
      'Try ejecting and reconnecting the device',
    ],
  },
  INSUFFICIENT_SPACE: {
    title: 'Insufficient Disk Space',
    description: 'The device does not have enough free space for the firmware.',
    resolutionSteps: [
      'Free up space on the device by deleting unnecessary files',
      'Typical firmware requires ~10 MB of free space',
      'Check available space in your file manager',
    ],
  },
  PERMISSION_DENIED: {
    title: 'Permission Denied',
    description: 'You do not have permission to access or modify the device.',
    resolutionSteps: [
      'macOS: System Settings → Privacy & Security → Full Disk Access → Add your Terminal or IDE',
      'Windows: Try running the application as Administrator',
      'Ensure you have admin/root privileges if required',
      'Try running the application with elevated permissions',
    ],
  },
  NETWORK_ERROR: {
    title: 'Network Error',
    description: 'Failed to download firmware from GitHub.',
    resolutionSteps: [
      'Check your internet connection',
      'Verify GitHub is accessible (not blocked by firewall)',
      'Try again later if GitHub is experiencing issues',
      'Check if you have reached GitHub API rate limits (60 requests/hour)',
    ],
  },
  FIRMWARE_DOWNLOAD_FAILED: {
    title: 'Firmware Download Failed',
    description: 'Could not download or extract the firmware file.',
    resolutionSteps: [
      'Check your internet connection',
      'Ensure you have enough disk space for the download',
      'Try selecting a different firmware version',
      'Clear browser cache and try again',
    ],
  },
  COPY_FAILED: {
    title: 'File Copy Failed',
    description: 'Failed to copy firmware files to the device.',
    resolutionSteps: [
      'Ensure the device is still connected',
      'Check that the device has enough free space',
      'Verify the device is not write-protected',
      'Close any programs that might be accessing the device',
    ],
  },
  CONFIG_WRITE_FAILED: {
    title: 'Configuration Write Failed',
    description: 'Failed to write configuration file to the device.',
    resolutionSteps: [
      'Ensure the device is still connected',
      'Check write permissions on the device',
      'Verify the device is not full',
      'Try manually creating a config.py file if needed',
    ],
  },
  // DFU-specific errors
  DFU_BOOTLOADER_FAILED: {
    title: 'Bootloader Entry Failed',
    description: 'Could not enter DFU bootloader mode on the device.',
    resolutionSteps: [
      'Ensure the device is connected and powered on',
      'Press the reset button twice quickly to manually enter DFU mode',
      'Look for a pulsing LED indicating bootloader mode',
      'Try a different USB cable or port',
    ],
  },
  DFU_TRANSFER_FAILED: {
    title: 'Firmware Transfer Failed',
    description: 'The firmware upload was interrupted.',
    resolutionSteps: [
      'Do not disconnect the device during firmware transfer',
      'Ensure the device has stable power',
      'Try resetting the device and starting over',
      'Check USB connection stability',
    ],
  },
  DFU_VALIDATION_FAILED: {
    title: 'Firmware Validation Failed',
    description: 'The device rejected the firmware after transfer.',
    resolutionSteps: [
      'Ensure you are using the correct firmware for your device',
      'Check that the firmware file is not corrupted',
      'Try downloading the firmware again',
      'Contact support if the issue persists',
    ],
  },
  SERIAL_PORT_ERROR: {
    title: 'Serial Port Error',
    description: 'Cannot communicate with the device serial port.',
    resolutionSteps: [
      'Check that no other application is using the serial port',
      'Ensure device drivers are properly installed',
      'Try unplugging and reconnecting the device',
      'Restart the application',
    ],
  },
  DFU_TIMEOUT: {
    title: 'DFU Timeout',
    description: 'Device did not respond within expected time.',
    resolutionSteps: [
      'The device may have disconnected - check USB connection',
      'Try resetting the device and starting over',
      'Ensure the device is not in a locked or frozen state',
      'Use a shorter or higher-quality USB cable',
    ],
  },
  ROLE_CONFIG_FAILED: {
    title: 'Role Configuration Failed',
    description: 'Failed to configure device role after firmware update.',
    resolutionSteps: [
      'The firmware was installed but role configuration failed',
      'Try manually configuring the device role via serial terminal',
      'Restart the device and try the update again',
    ],
  },
  INVALID_FIRMWARE_FORMAT: {
    title: 'Invalid Firmware Format',
    description: 'The firmware package is not in the expected Nordic DFU format.',
    resolutionSteps: [
      'Ensure the firmware zip contains manifest.json, firmware.bin, and firmware.dat',
      'Download the correct DFU firmware package from the releases page',
      'Contact support if you need a compatible firmware package',
    ],
  },
  DFU_CANCELLED: {
    title: 'Installation Cancelled',
    description: 'The firmware update was cancelled before completion.',
    resolutionSteps: [
      'Your device may be in bootloader mode',
      'Double-tap the reset button to enter DFU mode',
      'Reconnect and restart the update to complete installation',
      'If the device is unresponsive, unplug and reconnect it',
    ],
  },
  DFU_MAX_RETRIES: {
    title: 'Maximum Retries Exceeded',
    description: 'The firmware transfer failed after multiple automatic retry attempts.',
    resolutionSteps: [
      'The connection to the device is unstable',
      'Try using a different USB cable (prefer shorter, high-quality cables)',
      'Connect directly to your computer instead of through a USB hub',
      'Make sure the device has stable power',
      'Try a different USB port',
      'Restart both the device and the application',
    ],
  },
  DFU_DEVICE_DISCONNECTED: {
    title: 'Device Disconnected',
    description: 'The device was disconnected or became unresponsive during the update.',
    resolutionSteps: [
      'Ensure the device is securely connected via USB',
      'Do not move or bump the device during the update',
      'Try a different USB port or cable',
      'If the device is in bootloader mode, double-tap reset to restart it',
      'Restart the update process',
    ],
  },
  DFU_CRC_ERROR: {
    title: 'Data Transfer Error',
    description: 'Data corruption was detected during the firmware transfer.',
    resolutionSteps: [
      'This is usually caused by an unstable USB connection',
      'Try using a shorter or higher-quality USB cable',
      'Connect directly to your computer (avoid USB hubs)',
      'Ensure no other applications are using the device',
      'Restart the update - the application will automatically retry',
    ],
  },
  DFU_CONNECTION_UNSTABLE: {
    title: 'Unstable Connection',
    description: 'The connection to the device is experiencing intermittent issues.',
    resolutionSteps: [
      'Check that the USB cable is firmly connected',
      'Try a different USB port (prefer USB 3.0 ports)',
      'Use a shorter USB cable if possible',
      'Close other applications that may be using USB bandwidth',
      'The update may still succeed with automatic retries',
    ],
  },
  DFU_SERIAL_NUMBER_MISSING: {
    title: 'Device Identification Failed',
    description: 'Unable to track the device through mode changes due to missing serial number.',
    resolutionSteps: [
      'Try disconnecting and reconnecting the device',
      'Restart the application',
      'If this persists, the device may need to have its serial number programmed',
      'Contact support for assistance',
    ],
  },
  DFU_WINDOWS_DRIVER: {
    title: 'Windows Driver Issue',
    description: 'Windows USB driver encountered a temporary issue communicating with the device.',
    resolutionSteps: [
      'The application will automatically retry the operation',
      'If retries fail, try unplugging and reconnecting the device',
      'Ensure no other applications are using the device',
      'Try a different USB port (prefer USB 3.0 ports)',
      'Avoid USB hubs - connect directly to your computer',
      'Restart the application if the issue persists',
    ],
  },
  DFU_RETRYING: {
    title: 'Automatic Retry in Progress',
    description: 'The operation encountered a temporary issue and is being retried automatically.',
    resolutionSteps: [
      'This is normal behavior for intermittent USB communication issues',
      'Keep the device connected and wait for the retry to complete',
      'If multiple retries fail, try a different USB cable or port',
      'The update may still succeed after one or more retries',
    ],
  },
  RATE_LIMITED: {
    title: 'GitHub Rate Limit Exceeded',
    description: 'Too many requests have been made to the GitHub API.',
    resolutionSteps: [
      'Wait a few minutes before trying again',
      'GitHub allows 60 requests per hour for unauthenticated users',
      'Cached firmware versions are still available for installation',
      'Try again after the rate limit resets',
    ],
  },
};

export function getErrorGuidance(errorMessage: string): ErrorGuidance | null {
  // Match error patterns to guidance
  const lowerError = errorMessage.toLowerCase();

  // Check specific firmware format errors first (before generic "not found")
  if (lowerError.includes('missing file') || lowerError.includes('manifest.json') ||
      lowerError.includes('firmware.bin') || lowerError.includes('firmware.dat')) {
    return ERROR_GUIDANCE.INVALID_FIRMWARE_FORMAT;
  }

  if (lowerError.includes('not found') || lowerError.includes('does not exist')) {
    return ERROR_GUIDANCE.DEVICE_NOT_FOUND;
  }
  if (lowerError.includes('not writable') || lowerError.includes('read-only')) {
    return ERROR_GUIDANCE.DEVICE_NOT_WRITABLE;
  }
  if (lowerError.includes('insufficient') || lowerError.includes('no space') || lowerError.includes('disk space')) {
    return ERROR_GUIDANCE.INSUFFICIENT_SPACE;
  }
  if (lowerError.includes('permission denied') || lowerError.includes('access denied')) {
    return ERROR_GUIDANCE.PERMISSION_DENIED;
  }
  if (lowerError.includes('rate limit')) {
    return ERROR_GUIDANCE.RATE_LIMITED;
  }
  if (lowerError.includes('network') || lowerError.includes('connection')) {
    return ERROR_GUIDANCE.NETWORK_ERROR;
  }
  if (lowerError.includes('download') || lowerError.includes('fetch')) {
    return ERROR_GUIDANCE.FIRMWARE_DOWNLOAD_FAILED;
  }
  if (lowerError.includes('copy') || lowerError.includes('transfer')) {
    return ERROR_GUIDANCE.COPY_FAILED;
  }
  if (lowerError.includes('config')) {
    return ERROR_GUIDANCE.CONFIG_WRITE_FAILED;
  }

  // DFU-specific error patterns - check more specific patterns first

  // Windows driver issues
  if (lowerError.includes('not functioning') ||
      (lowerError.includes('windows') && lowerError.includes('driver'))) {
    return ERROR_GUIDANCE.DFU_WINDOWS_DRIVER;
  }

  if (lowerError.includes('max retries') || lowerError.includes('retries exceeded') ||
      lowerError.includes('retry attempt')) {
    return ERROR_GUIDANCE.DFU_MAX_RETRIES;
  }
  if (lowerError.includes('disconnected') || lowerError.includes('health check')) {
    return ERROR_GUIDANCE.DFU_DEVICE_DISCONNECTED;
  }
  if (lowerError.includes('crc') || lowerError.includes('checksum') ||
      lowerError.includes('data corruption')) {
    return ERROR_GUIDANCE.DFU_CRC_ERROR;
  }
  if (lowerError.includes('no serial number') || lowerError.includes('serial number')) {
    return ERROR_GUIDANCE.DFU_SERIAL_NUMBER_MISSING;
  }
  if (lowerError.includes('bootloader') || lowerError.includes('dfu mode')) {
    return ERROR_GUIDANCE.DFU_BOOTLOADER_FAILED;
  }
  if (lowerError.includes('serial') || lowerError.includes('port')) {
    return ERROR_GUIDANCE.SERIAL_PORT_ERROR;
  }
  if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
    return ERROR_GUIDANCE.DFU_TIMEOUT;
  }
  if (lowerError.includes('validation') || lowerError.includes('rejected')) {
    return ERROR_GUIDANCE.DFU_VALIDATION_FAILED;
  }
  if (lowerError.includes('role') && lowerError.includes('config')) {
    return ERROR_GUIDANCE.ROLE_CONFIG_FAILED;
  }
  if (lowerError.includes('cancelled') || lowerError.includes('canceled')) {
    return ERROR_GUIDANCE.DFU_CANCELLED;
  }
  // Catch-all for general connection issues with retry indicators
  if ((lowerError.includes('retry') || lowerError.includes('recovered')) &&
      lowerError.includes('connection')) {
    return ERROR_GUIDANCE.DFU_CONNECTION_UNSTABLE;
  }

  return null;
}

export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) return '';
  if (errors.length === 1) return errors[0];
  return errors.map((err, idx) => `${idx + 1}. ${err}`).join('\n');
}

export function formatValidationWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';
  return warnings.map((warn) => `⚠️ ${warn}`).join('\n');
}

/**
 * Filter resolution steps by platform.
 * Steps prefixed with "macOS:", "Windows:", or "Linux:" are only shown
 * on the matching platform. The prefix is stripped for display.
 * Steps without a platform prefix are shown on all platforms.
 */
function filterStepsByPlatform(steps: string[], platform: string): string[] {
  const platformPrefixes: Record<string, string[]> = {
    macos: ['macOS:', 'On macOS:'],
    windows: ['Windows:', 'On Windows:'],
    linux: ['Linux:', 'On Linux:'],
  };

  return steps
    .filter((step) => {
      // Check if step has ANY platform prefix
      const allPrefixes = Object.values(platformPrefixes).flat();
      const hasPrefix = allPrefixes.some((p) => step.startsWith(p));
      if (!hasPrefix) return true; // Generic step — always include

      // Step has a platform prefix — only include if it matches current platform
      const matchingPrefixes = platformPrefixes[platform] || [];
      return matchingPrefixes.some((p) => step.startsWith(p));
    })
    .map((step) => {
      // Strip matching platform prefix for cleaner display
      const matchingPrefixes = platformPrefixes[platform] || [];
      for (const prefix of matchingPrefixes) {
        if (step.startsWith(prefix)) {
          return step.slice(prefix.length).trim();
        }
      }
      return step;
    });
}

/**
 * Get error guidance with platform-specific resolution steps.
 * If platform is not provided, returns all steps unfiltered.
 */
export function getErrorGuidanceForPlatform(
  errorMessage: string,
  platform?: string
): ErrorGuidance | null {
  const guidance = getErrorGuidance(errorMessage);
  if (!guidance || !platform) return guidance;

  return {
    ...guidance,
    resolutionSteps: filterStepsByPlatform(guidance.resolutionSteps, platform),
  };
}
