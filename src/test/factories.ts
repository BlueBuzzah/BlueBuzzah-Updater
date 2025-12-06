import type {
  FirmwareRelease,
  FirmwareAsset,
  FirmwareBundle,
  Device,
  UpdateProgress,
  UpdateResult,
  DeviceUpdateResult,
  ValidationResult,
  GitHubRelease,
  GitHubAsset,
  CachedFirmwareMetadata,
} from '@/types';

// === Firmware Factories ===

export const createMockAsset = (overrides?: Partial<FirmwareAsset>): FirmwareAsset => ({
  name: 'firmware-v1.0.0.zip',
  downloadUrl: 'https://github.com/test/releases/download/v1.0.0/firmware.zip',
  size: 1024000,
  ...overrides,
});

export const createMockRelease = (overrides?: Partial<FirmwareRelease>): FirmwareRelease => ({
  version: '1.0.0',
  tagName: 'v1.0.0',
  releaseNotes: 'Test release notes',
  publishedAt: new Date('2024-01-15'),
  downloadUrl: 'https://github.com/test/releases/download/v1.0.0/firmware.zip',
  assets: [createMockAsset()],
  isPrerelease: false,
  ...overrides,
});

export const createMockBundle = (overrides?: Partial<FirmwareBundle>): FirmwareBundle => ({
  version: '1.0.0',
  localPath: '/tmp/firmware/v1.0.0',
  ...overrides,
});

export const createMockCachedMetadata = (
  overrides?: Partial<CachedFirmwareMetadata>
): CachedFirmwareMetadata => ({
  version: '1.0.0',
  tag_name: 'v1.0.0',
  sha256_hash: 'abc123def456',
  zip_path: '/cache/firmware/v1.0.0.zip',
  downloaded_at: '2024-01-15T12:00:00Z',
  file_size: 1024000,
  published_at: '2024-01-15T00:00:00Z',
  release_notes: 'Test release notes',
  ...overrides,
});

// === GitHub API Factories ===

export const createMockGitHubAsset = (overrides?: Partial<GitHubAsset>): GitHubAsset => ({
  name: 'firmware-v1.0.0.zip',
  browser_download_url: 'https://github.com/test/releases/download/v1.0.0/firmware.zip',
  size: 1024000,
  ...overrides,
});

export const createMockGitHubRelease = (overrides?: Partial<GitHubRelease>): GitHubRelease => ({
  tag_name: 'v1.0.0',
  name: '1.0.0',
  body: 'Test release notes',
  published_at: '2024-01-15T00:00:00Z',
  prerelease: false,
  assets: [createMockGitHubAsset()],
  ...overrides,
});

// === Device Factories ===

export const createMockDevice = (overrides?: Partial<Device>): Device => ({
  path: '/dev/cu.usbmodem1234',
  label: 'Feather nRF52840',
  isCircuitPy: false,
  vid: 0x239a,
  pid: 0x8029,
  inBootloader: false,
  serialNumber: 'ABC123',
  ...overrides,
});

export const createMockValidation = (overrides?: Partial<ValidationResult>): ValidationResult => ({
  valid: true,
  errors: [],
  warnings: [],
  availableSpaceMB: 100,
  requiredSpaceMB: 10,
  ...overrides,
});

// === Progress Factories ===

export const createMockProgress = (overrides?: Partial<UpdateProgress>): UpdateProgress => ({
  devicePath: '/dev/cu.usbmodem1234',
  stage: 'copying',
  progress: 50,
  message: 'Uploading firmware...',
  ...overrides,
});

export const createMockDeviceUpdateResult = (
  overrides?: Partial<DeviceUpdateResult>
): DeviceUpdateResult => ({
  device: createMockDevice(),
  success: true,
  ...overrides,
});

export const createMockUpdateResult = (overrides?: Partial<UpdateResult>): UpdateResult => ({
  success: true,
  message: 'All devices updated successfully',
  deviceUpdates: [createMockDeviceUpdateResult()],
  ...overrides,
});

// === Helper Functions ===

/**
 * Creates multiple mock releases with incrementing versions
 */
export const createMockReleases = (count: number): FirmwareRelease[] => {
  return Array.from({ length: count }, (_, i) => {
    const version = `1.${i}.0`;
    const date = new Date('2024-01-15');
    date.setDate(date.getDate() - i);
    return createMockRelease({
      version,
      tagName: `v${version}`,
      publishedAt: date,
      assets: [
        createMockAsset({
          name: `firmware-v${version}.zip`,
          downloadUrl: `https://github.com/test/releases/download/v${version}/firmware.zip`,
        }),
      ],
    });
  });
};

/**
 * Creates multiple mock devices
 */
export const createMockDevices = (count: number): Device[] => {
  return Array.from({ length: count }, (_, i) => {
    const num = i + 1;
    return createMockDevice({
      path: `/dev/cu.usbmodem${1234 + i}`,
      label: `Feather nRF52840 #${num}`,
      serialNumber: `ABC${100 + i}`,
    });
  });
};
