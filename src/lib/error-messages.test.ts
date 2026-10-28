import { summarizeDeviceError } from './error-messages';
import { describe, it, expect } from 'vitest';
import {
  getErrorGuidance,
  getErrorGuidanceForPlatform,
  formatValidationErrors,
  formatValidationWarnings,
  ERROR_GUIDANCE,
} from './error-messages';

describe('getErrorGuidance', () => {
  describe('DEVICE_NOT_FOUND pattern', () => {
    it('matches "not found" errors', () => {
      expect(getErrorGuidance('Device not found')).toBe(ERROR_GUIDANCE.DEVICE_NOT_FOUND);
      expect(getErrorGuidance('File not found on disk')).toBe(ERROR_GUIDANCE.DEVICE_NOT_FOUND);
    });

    it('matches "does not exist" errors', () => {
      expect(getErrorGuidance('Path does not exist')).toBe(ERROR_GUIDANCE.DEVICE_NOT_FOUND);
      expect(getErrorGuidance('Directory does not exist')).toBe(ERROR_GUIDANCE.DEVICE_NOT_FOUND);
    });
  });

  describe('PERMISSION_DENIED pattern', () => {
    it('matches "permission denied" errors', () => {
      expect(getErrorGuidance('Permission denied')).toBe(ERROR_GUIDANCE.PERMISSION_DENIED);
      expect(getErrorGuidance('Error: Permission denied for file')).toBe(ERROR_GUIDANCE.PERMISSION_DENIED);
    });

    it('matches "access denied" errors', () => {
      expect(getErrorGuidance('Access denied')).toBe(ERROR_GUIDANCE.PERMISSION_DENIED);
      expect(getErrorGuidance('Access denied to path')).toBe(ERROR_GUIDANCE.PERMISSION_DENIED);
    });
  });

  describe('RATE_LIMITED pattern', () => {
    it('matches "rate limit" errors', () => {
      expect(getErrorGuidance('GitHub API rate limit exceeded')).toBe(ERROR_GUIDANCE.RATE_LIMITED);
      expect(getErrorGuidance('Rate limit exceeded. Try again later.')).toBe(ERROR_GUIDANCE.RATE_LIMITED);
    });

    it('matches rate limit with wait time', () => {
      expect(getErrorGuidance('GitHub API rate limit exceeded. Try again in 5 minutes.')).toBe(ERROR_GUIDANCE.RATE_LIMITED);
    });
  });

  describe('NETWORK_ERROR pattern', () => {
    it('matches "network" errors', () => {
      expect(getErrorGuidance('Network error occurred')).toBe(ERROR_GUIDANCE.NETWORK_ERROR);
      expect(getErrorGuidance('Network unavailable')).toBe(ERROR_GUIDANCE.NETWORK_ERROR);
    });

    it('matches "connection" errors', () => {
      expect(getErrorGuidance('Connection failed')).toBe(ERROR_GUIDANCE.NETWORK_ERROR);
      expect(getErrorGuidance('Lost connection to server')).toBe(ERROR_GUIDANCE.NETWORK_ERROR);
    });
  });

  describe('FIRMWARE_DOWNLOAD_FAILED pattern', () => {
    it('matches "download" errors', () => {
      expect(getErrorGuidance('Failed to download firmware')).toBe(ERROR_GUIDANCE.FIRMWARE_DOWNLOAD_FAILED);
      expect(getErrorGuidance('Download interrupted')).toBe(ERROR_GUIDANCE.FIRMWARE_DOWNLOAD_FAILED);
    });

    it('matches "fetch" errors', () => {
      expect(getErrorGuidance('Fetch failed')).toBe(ERROR_GUIDANCE.FIRMWARE_DOWNLOAD_FAILED);
      expect(getErrorGuidance('Failed to fetch release')).toBe(ERROR_GUIDANCE.FIRMWARE_DOWNLOAD_FAILED);
    });
  });

  describe('DFU_TRANSFER_FAILED pattern', () => {
    it('matches transfer errors', () => {
      expect(getErrorGuidance('Transfer failed')).toBe(ERROR_GUIDANCE.DFU_TRANSFER_FAILED);
    });
  });
  describe('INVALID_FIRMWARE_FORMAT pattern', () => {
    it('matches "missing file" errors', () => {
      expect(getErrorGuidance('Missing file in firmware.zip: manifest.json')).toBe(ERROR_GUIDANCE.INVALID_FIRMWARE_FORMAT);
      expect(getErrorGuidance('Missing file: firmware.bin')).toBe(ERROR_GUIDANCE.INVALID_FIRMWARE_FORMAT);
    });

    it('matches manifest.json errors', () => {
      expect(getErrorGuidance('Cannot find manifest.json')).toBe(ERROR_GUIDANCE.INVALID_FIRMWARE_FORMAT);
    });

    it('matches firmware.bin errors', () => {
      expect(getErrorGuidance('firmware.bin not found in package')).toBe(ERROR_GUIDANCE.INVALID_FIRMWARE_FORMAT);
    });

    it('matches firmware.dat errors', () => {
      expect(getErrorGuidance('Missing firmware.dat')).toBe(ERROR_GUIDANCE.INVALID_FIRMWARE_FORMAT);
    });
  });

  describe('case insensitivity', () => {
    it('matches uppercase errors', () => {
      expect(getErrorGuidance('PERMISSION DENIED')).toBe(ERROR_GUIDANCE.PERMISSION_DENIED);
      expect(getErrorGuidance('NOT FOUND')).toBe(ERROR_GUIDANCE.DEVICE_NOT_FOUND);
    });

    it('matches mixed case errors', () => {
      expect(getErrorGuidance('Permission Denied')).toBe(ERROR_GUIDANCE.PERMISSION_DENIED);
      expect(getErrorGuidance('Network Error')).toBe(ERROR_GUIDANCE.NETWORK_ERROR);
    });
  });

  describe('unmatched errors', () => {
    it('returns null for unmatched errors', () => {
      expect(getErrorGuidance('Some random error')).toBeNull();
      expect(getErrorGuidance('Unknown issue occurred')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(getErrorGuidance('')).toBeNull();
    });
  });
});

describe('formatValidationErrors', () => {
  it('returns empty string for empty array', () => {
    expect(formatValidationErrors([])).toBe('');
  });

  it('returns single error without numbering', () => {
    expect(formatValidationErrors(['Error one'])).toBe('Error one');
  });

  it('formats multiple errors with numbers', () => {
    const result = formatValidationErrors(['Error one', 'Error two', 'Error three']);
    expect(result).toBe('1. Error one\n2. Error two\n3. Error three');
  });

  it('handles two errors', () => {
    const result = formatValidationErrors(['First error', 'Second error']);
    expect(result).toBe('1. First error\n2. Second error');
  });
});

describe('formatValidationWarnings', () => {
  it('returns empty string for empty array', () => {
    expect(formatValidationWarnings([])).toBe('');
  });

  it('formats single warning with emoji', () => {
    const result = formatValidationWarnings(['Warning one']);
    expect(result).toBe('Warning: Warning one');
  });

  it('formats multiple warnings with emoji prefix', () => {
    const result = formatValidationWarnings(['Warning one', 'Warning two']);
    expect(result).toBe('Warning: Warning one\nWarning: Warning two');
  });

  it('handles three warnings', () => {
    const result = formatValidationWarnings(['First', 'Second', 'Third']);
    expect(result).toBe('Warning: First\nWarning: Second\nWarning: Third');
  });
});

describe('ERROR_GUIDANCE structure', () => {
  it('all guidance entries have required fields', () => {
    const requiredKeys = ['title', 'description', 'resolutionSteps'];

    Object.values(ERROR_GUIDANCE).forEach((guidance) => {
      requiredKeys.forEach((key) => {
        expect(guidance).toHaveProperty(key);
      });
    });
  });

  it('all guidance entries have non-empty resolution steps', () => {
    Object.values(ERROR_GUIDANCE).forEach((guidance) => {
      expect(guidance.resolutionSteps.length).toBeGreaterThan(0);
    });
  });

  it('all guidance entries have non-empty title and description', () => {
    Object.values(ERROR_GUIDANCE).forEach((guidance) => {
      expect(guidance.title.length).toBeGreaterThan(0);
      expect(guidance.description.length).toBeGreaterThan(0);
    });
  });
});

describe('getErrorGuidanceForPlatform', () => {
  it('returns null for unmatched errors', () => {
    expect(getErrorGuidanceForPlatform('completely random error', 'macos')).toBeNull();
  });

  it('keeps generic steps on every platform', () => {
    const steps = getErrorGuidance('Permission denied')!.resolutionSteps;
    expect(getErrorGuidanceForPlatform('Permission denied', 'macos')!.resolutionSteps).toEqual(steps);
    expect(getErrorGuidanceForPlatform('Permission denied', 'windows')!.resolutionSteps).toEqual(steps);
  });
});

describe('summarizeDeviceError', () => {
  // The firmware echoes its whole serial boot/status stream back inside a
  // timeout message. Rendering that verbatim on a device card is unreadable;
  // the full text belongs in the copyable log instead.
  const noisy =
    'Timeout waiting for menu response to PROFILE_LOAD:4. Received: [BLE] UART service discovered, notifications enabled\n' +
    ' [BLE] PRIMARY connection interval: 10.0ms [CONNECT] Handle: 1, Type: PRIMARY\n' +
    ' [STATUS] Role: SECONDARY | State: READY';

  it('drops the echoed device output after "Received:"', () => {
    const summary = summarizeDeviceError(noisy);
    expect(summary).toBe(
      'Timeout waiting for menu response to PROFILE_LOAD:4.'
    );
    expect(summary).not.toContain('[BLE]');
    expect(summary).not.toContain('\n');
  });

  it('keeps a short single-line message unchanged', () => {
    expect(summarizeDeviceError('Device not found')).toBe('Device not found');
  });

  it('collapses a multi-line message to its first line', () => {
    expect(summarizeDeviceError('Port busy\n  at foo\n  at bar')).toBe(
      'Port busy'
    );
  });

  it('never truncates a long line (nothing truncates mid-word)', () => {
    const long = `Failed because ${'x'.repeat(400)}`;
    expect(summarizeDeviceError(long)).toBe(long);
  });

  it('falls back for an empty or whitespace-only message', () => {
    expect(summarizeDeviceError('   ')).toBe("Setup didn't finish. Open the log for details.");
    expect(summarizeDeviceError('')).toBe("Setup didn't finish. Open the log for details.");
  });
});

describe('catalog voice', () => {
  const entries = Object.values(ERROR_GUIDANCE);

  it('uses sentence case for every title', () => {
    for (const { title } of entries) {
      expect(title.replace(/\b(BlueBuzzah|GitHub|USB|Primary|Secondary|Windows)\b/g, '').trim().slice(1)).not.toMatch(/[A-Z]/);
    }
  });

  it('has no exclamation marks, emoji, obsolete advice or double-tap steps', () => {
    const text = JSON.stringify(ERROR_GUIDANCE);
    for (const banned of ['!', '⚠', 'config.py', 'file manager', 'twice', 'double-tap']) {
      expect(text).not.toContain(banned);
    }
  });

  it('dropped the mass-storage era entries', () => {
    for (const key of ['DEVICE_NOT_WRITABLE', 'INSUFFICIENT_SPACE', 'COPY_FAILED', 'CONFIG_WRITE_FAILED']) {
      expect(ERROR_GUIDANCE).not.toHaveProperty(key);
    }
  });
});

describe('matcher fixes', () => {
  it('reaches ROLE_CONFIG_FAILED', () => {
    expect(getErrorGuidance('Role configuration failed after config write')).toBe(ERROR_GUIDANCE.ROLE_CONFIG_FAILED);
  });

  it('sends an unstable USB connection to DFU_CONNECTION_UNSTABLE, not the GitHub message', () => {
    expect(getErrorGuidance('USB connection unstable')).toBe(ERROR_GUIDANCE.DFU_CONNECTION_UNSTABLE);
  });

  it('does not read "unsupported" as a port error', () => {
    expect(getErrorGuidance('unsupported board')).not.toBe(ERROR_GUIDANCE.SERIAL_PORT_ERROR);
  });

  it('extracts a DFU error code for the detail line', () => {
    expect(getErrorGuidance('DFU-014 timeout waiting for device')?.code).toBe('DFU-014');
  });

  it('names the Update Firmware button in the stopped-flash steps', () => {
    expect(ERROR_GUIDANCE.DFU_CANCELLED.resolutionSteps).toContain('Select Update Firmware to start again.');
  });
});
