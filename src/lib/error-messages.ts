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
      'On macOS: Grant Full Disk Access in System Settings → Privacy & Security → Full Disk Access',
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

  // DFU-specific error patterns
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
