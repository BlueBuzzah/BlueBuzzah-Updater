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
  WIPE_FAILED: {
    title: 'Device Wipe Failed',
    description: 'Could not clear existing files from the device.',
    resolutionSteps: [
      'Close any programs accessing files on the device',
      'Check for read-only or locked files',
      'Manually delete files if needed, then retry',
      'Ensure the device is not write-protected',
    ],
  },
};

export function getErrorGuidance(errorMessage: string): ErrorGuidance | null {
  // Match error patterns to guidance
  const lowerError = errorMessage.toLowerCase();

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
  if (lowerError.includes('wipe') || lowerError.includes('remove') || lowerError.includes('delete')) {
    return ERROR_GUIDANCE.WIPE_FAILED;
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
