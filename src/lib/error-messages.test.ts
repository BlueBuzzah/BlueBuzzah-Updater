import { describe, it, expect } from 'vitest';
import {
  getErrorGuidance,
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

  describe('DEVICE_NOT_WRITABLE pattern', () => {
    it('matches "not writable" errors', () => {
      expect(getErrorGuidance('Device is not writable')).toBe(ERROR_GUIDANCE.DEVICE_NOT_WRITABLE);
    });

    it('matches "read-only" errors', () => {
      expect(getErrorGuidance('File system is read-only')).toBe(ERROR_GUIDANCE.DEVICE_NOT_WRITABLE);
      expect(getErrorGuidance('Read-only file system')).toBe(ERROR_GUIDANCE.DEVICE_NOT_WRITABLE);
    });
  });

  describe('INSUFFICIENT_SPACE pattern', () => {
    it('matches "insufficient" errors', () => {
      expect(getErrorGuidance('Insufficient space on device')).toBe(ERROR_GUIDANCE.INSUFFICIENT_SPACE);
    });

    it('matches "no space" errors', () => {
      expect(getErrorGuidance('No space left on device')).toBe(ERROR_GUIDANCE.INSUFFICIENT_SPACE);
    });

    it('matches "disk space" errors', () => {
      expect(getErrorGuidance('Not enough disk space')).toBe(ERROR_GUIDANCE.INSUFFICIENT_SPACE);
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

  describe('COPY_FAILED pattern', () => {
    it('matches "copy" errors', () => {
      expect(getErrorGuidance('Failed to copy file')).toBe(ERROR_GUIDANCE.COPY_FAILED);
      expect(getErrorGuidance('Copy operation failed')).toBe(ERROR_GUIDANCE.COPY_FAILED);
    });

    it('matches "transfer" errors', () => {
      expect(getErrorGuidance('Transfer failed')).toBe(ERROR_GUIDANCE.COPY_FAILED);
      expect(getErrorGuidance('File transfer error')).toBe(ERROR_GUIDANCE.COPY_FAILED);
    });
  });

  describe('CONFIG_WRITE_FAILED pattern', () => {
    it('matches "config" errors', () => {
      expect(getErrorGuidance('Failed to write config')).toBe(ERROR_GUIDANCE.CONFIG_WRITE_FAILED);
      expect(getErrorGuidance('Config file error')).toBe(ERROR_GUIDANCE.CONFIG_WRITE_FAILED);
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
    expect(result).toBe('⚠️ Warning one');
  });

  it('formats multiple warnings with emoji prefix', () => {
    const result = formatValidationWarnings(['Warning one', 'Warning two']);
    expect(result).toBe('⚠️ Warning one\n⚠️ Warning two');
  });

  it('handles three warnings', () => {
    const result = formatValidationWarnings(['First', 'Second', 'Third']);
    expect(result).toBe('⚠️ First\n⚠️ Second\n⚠️ Third');
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
