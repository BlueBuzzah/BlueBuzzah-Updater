// Error message mapping and troubleshooting guidance.
// Copy follows the design system's voice: say what happened, then what to do;
// codes and raw detail go underneath in code-s, never in the title.

export interface ErrorGuidance {
  title: string;
  description: string;
  resolutionSteps: string[];
  /** Stable DFU-0xx code from the backend, shown in the detail line */
  code?: string;
}

const REPLUG = 'Unplug the device, wait 5 seconds, then plug it back in.';
const TRY_AGAIN = 'Select Try again.';
const NO_HUB = 'Plug the device straight into your computer, not into a hub.';

export const ERROR_GUIDANCE: Record<string, ErrorGuidance> = {
  DEVICE_NOT_FOUND: {
    title: "Can't find your device",
    description: 'The device was unplugged or stopped responding.',
    resolutionSteps: ['Check the USB cable is plugged in at both ends.', REPLUG, 'Select Rescan.'],
  },
  PERMISSION_DENIED: {
    title: 'Your computer blocked the device',
    description: "The Updater isn't allowed to open the device's USB port.",
    resolutionSteps: [
      'Close any other app that uses the device, such as a serial monitor.',
      'Unplug the device, then plug it back in.',
      'Restart the Updater.',
    ],
  },
  NETWORK_ERROR: {
    title: "Can't reach GitHub",
    description: "We download firmware from GitHub, and the connection didn't work.",
    resolutionSteps: [
      'Check your internet connection.',
      'Wait a minute, then select Try again.',
      'Firmware you downloaded before is still available.',
    ],
  },
  FIRMWARE_DOWNLOAD_FAILED: {
    title: "Firmware download didn't finish",
    description: "The firmware file couldn't be downloaded or opened.",
    resolutionSteps: ['Check your internet connection.', TRY_AGAIN, 'If it fails again, choose a different version.'],
  },
  DFU_BOOTLOADER_FAILED: {
    title: "Couldn't get the device ready",
    description: "The device didn't switch into update mode.",
    resolutionSteps: [REPLUG, 'Try a different USB cable or port.', TRY_AGAIN],
  },
  DFU_TRANSFER_FAILED: {
    title: 'Firmware transfer stopped',
    description: 'The connection broke while firmware was being written.',
    resolutionSteps: ['Keep the device plugged in and still during the flash.', 'Try a different USB cable or port.', TRY_AGAIN],
  },
  DFU_VALIDATION_FAILED: {
    title: "The device didn't accept the firmware",
    description: 'The firmware arrived, but the device rejected it.',
    resolutionSteps: ['Check that you chose firmware for this device.', 'Delete the download, then flash again to get a fresh copy.'],
  },
  SERIAL_PORT_ERROR: {
    title: "Can't talk to the device",
    description: "Another app may be using the device's USB port.",
    resolutionSteps: [
      'Close other apps that use the device, such as a serial monitor.',
      'Unplug the device, then plug it back in.',
      'Restart the Updater.',
    ],
  },
  DFU_TIMEOUT: {
    title: 'The device stopped answering',
    description: "The device didn't reply in time.",
    resolutionSteps: ['Check the USB cable is plugged in at both ends.', REPLUG, TRY_AGAIN],
  },
  ROLE_CONFIG_FAILED: {
    title: "Firmware installed, but the role wasn't set",
    description: "The new firmware is on the device. Setting it as Primary or Secondary didn't finish.",
    resolutionSteps: ['Unplug the device, then plug it back in.', 'Flash it again. The firmware is already downloaded.'],
  },
  INVALID_FIRMWARE_FORMAT: {
    title: "This firmware can't be used",
    description: "The download isn't a firmware package the Updater can flash.",
    resolutionSteps: ['Choose a different version.'],
  },
  DFU_CANCELLED: {
    title: 'Flash stopped',
    description: 'The flash stopped before it finished. The device may not start until you flash it again.',
    resolutionSteps: ['Keep the device plugged in.', 'Select Update firmware to start again.'],
  },
  DFU_MAX_RETRIES: {
    title: 'Flash failed after several tries',
    description: 'The USB connection kept dropping.',
    resolutionSteps: [NO_HUB, 'Try a shorter USB cable or a different port.', TRY_AGAIN],
  },
  DFU_DEVICE_DISCONNECTED: {
    title: 'The device was unplugged during the flash',
    description: 'The connection was lost before the flash finished.',
    resolutionSteps: ['Plug the device back in.', 'Keep it still until the flash finishes.', TRY_AGAIN],
  },
  DFU_CRC_ERROR: {
    title: 'Some firmware data arrived damaged',
    description: 'This usually means the USB connection is unreliable.',
    resolutionSteps: [NO_HUB, 'Try a shorter USB cable.', TRY_AGAIN],
  },
  DFU_CONNECTION_UNSTABLE: {
    title: 'The USB connection is unreliable',
    description: 'The flash may still finish. The Updater tries again on its own.',
    resolutionSteps: ['Check the USB cable is pushed in firmly.', 'If it fails, try a different cable or port.'],
  },
  DFU_SERIAL_NUMBER_MISSING: {
    title: "Can't keep track of this device",
    description: "The device doesn't report a serial number, so the Updater loses it when it restarts.",
    resolutionSteps: ['Unplug the device, then plug it back in.', 'Restart the Updater, then try again.'],
  },
  DFU_WINDOWS_DRIVER: {
    title: 'Windows lost the USB connection for a moment',
    description: 'The Updater tries again on its own.',
    resolutionSteps: ['If it fails, unplug the device and plug it back in.', 'Plug it straight into your computer, not into a hub.'],
  },
  DFU_RETRYING: {
    title: 'Trying again',
    description: 'The connection dropped for a moment. The Updater is trying again.',
    resolutionSteps: ['Keep the device plugged in.'],
  },
  RATE_LIMITED: {
    title: 'GitHub asked us to wait',
    description: 'There were too many firmware checks in the last hour.',
    resolutionSteps: ['Wait a few minutes, then select Try again.', 'Firmware you downloaded before is still available.'],
  },
};

function matchGuidance(lower: string): ErrorGuidance | null {
  const has = (...words: string[]) => words.some((w) => lower.includes(w));
  const word = (w: string) => new RegExp(`\\b${w}\\b`).test(lower);

  // Specific firmware format errors first (before generic "not found")
  if (has('missing file', 'manifest.json', 'firmware.bin', 'firmware.dat')) return ERROR_GUIDANCE.INVALID_FIRMWARE_FORMAT;
  if (has('role') && has('config')) return ERROR_GUIDANCE.ROLE_CONFIG_FAILED;
  if (has('not found', 'does not exist')) return ERROR_GUIDANCE.DEVICE_NOT_FOUND;
  if (has('permission denied', 'access denied')) return ERROR_GUIDANCE.PERMISSION_DENIED;
  if (has('rate limit')) return ERROR_GUIDANCE.RATE_LIMITED;
  // A flaky USB link is not a GitHub problem: check it before the network rule.
  if (has('connection') && has('unstable', 'usb', 'retry', 'recovered', 'intermittent')) return ERROR_GUIDANCE.DFU_CONNECTION_UNSTABLE;
  if (has('network', 'connection')) return ERROR_GUIDANCE.NETWORK_ERROR;
  if (has('download', 'fetch')) return ERROR_GUIDANCE.FIRMWARE_DOWNLOAD_FAILED;
  if (has('not functioning') || (has('windows') && has('driver'))) return ERROR_GUIDANCE.DFU_WINDOWS_DRIVER;
  if (has('max retries', 'retries exceeded', 'retry attempt')) return ERROR_GUIDANCE.DFU_MAX_RETRIES;
  if (has('disconnected', 'health check')) return ERROR_GUIDANCE.DFU_DEVICE_DISCONNECTED;
  if (has('crc', 'checksum', 'data corruption')) return ERROR_GUIDANCE.DFU_CRC_ERROR;
  if (has('serial number')) return ERROR_GUIDANCE.DFU_SERIAL_NUMBER_MISSING;
  if (has('bootloader', 'dfu mode')) return ERROR_GUIDANCE.DFU_BOOTLOADER_FAILED;
  if (has('transfer')) return ERROR_GUIDANCE.DFU_TRANSFER_FAILED;
  if (word('serial') || word('port')) return ERROR_GUIDANCE.SERIAL_PORT_ERROR;
  if (has('timeout', 'timed out')) return ERROR_GUIDANCE.DFU_TIMEOUT;
  if (has('validation', 'rejected')) return ERROR_GUIDANCE.DFU_VALIDATION_FAILED;
  if (has('cancelled', 'canceled')) return ERROR_GUIDANCE.DFU_CANCELLED;
  return null;
}

export function getErrorGuidance(errorMessage: string): ErrorGuidance | null {
  const guidance = matchGuidance(errorMessage.toLowerCase());
  if (!guidance) return null;
  const code = errorMessage.match(/DFU-0\d{2}/)?.[0];
  return code ? { ...guidance, code } : guidance;
}

export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) return '';
  if (errors.length === 1) return errors[0];
  return errors.map((err, idx) => `${idx + 1}. ${err}`).join('\n');
}

export function formatValidationWarnings(warnings: string[]): string {
  if (warnings.length === 0) return '';
  return warnings.map((warn) => `Warning: ${warn}`).join('\n');
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

const FALLBACK_SUMMARY = "Setup didn't finish. Open the log for details.";

export function summarizeDeviceError(raw: string): string {
  const text = (raw ?? '').trim();
  if (!text) return FALLBACK_SUMMARY;

  // Cut the echoed device output, keeping the sentence that introduces it.
  // Coupled to the exact ". Received:" wording that `dfu/menu.rs` builds its
  // timeout reasons with. If that wording changes, this silently stops cutting
  // rather than failing, and raw device output reaches the card — so the two
  // must be changed together.
  const echoIndex = text.search(/\.\s*Received:/i);
  const withoutEcho = echoIndex >= 0 ? text.slice(0, echoIndex + 1) : text;

  // Nothing truncates (README Type): the first line is shown whole and wraps.
  return withoutEcho.split('\n')[0].trim() || FALLBACK_SUMMARY;
}
