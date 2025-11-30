// Domain Models
export interface FirmwareRelease {
  version: string;
  tagName: string;
  releaseNotes: string;
  publishedAt: Date;
  downloadUrl: string;
  assets: FirmwareAsset[];
  sha256Hash?: string;
  isCached?: boolean;
  cachedMetadata?: CachedFirmwareMetadata;
}

export interface FirmwareAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface CachedFirmwareMetadata {
  version: string;
  tag_name: string;
  sha256_hash: string;
  zip_path: string;
  downloaded_at: string;
  file_size: number;
  published_at: string;
  release_notes: string;
}

export type FirmwareCacheIndex = Record<string, CachedFirmwareMetadata>;

export interface Device {
  path: string;           // Serial port path (e.g., "/dev/cu.usbmodem1234" or "COM3")
  label: string;          // Display label for the device
  role?: DeviceRole;
  isCircuitPy: boolean;   // false for DFU devices
  // DFU-specific fields
  vid?: number;           // USB Vendor ID
  pid?: number;           // USB Product ID
  inBootloader?: boolean; // Whether device is in bootloader mode
  serialNumber?: string;  // Device serial number
}

// DFU progress event from backend
export interface DfuProgress {
  stage: string;          // Stage name (reading, bootloader, uploading, etc.)
  sent?: number;          // Bytes sent (for uploading)
  total?: number;         // Total bytes (for uploading)
  percent: number;        // Progress percentage (0-100)
  message: string;        // Human-readable message
}

export type DeviceRole = 'PRIMARY' | 'SECONDARY';

export interface FirmwareBundle {
  version: string;
  localPath: string;
}

export interface UpdateProgress {
  devicePath: string;
  stage: UpdateStage;
  currentFile?: string;
  progress: number;
  message: string;
  newDeviceLabel?: string;
  newDevicePath?: string;
}

export type UpdateStage =
  | 'downloading'
  | 'preparing'
  | 'copying'
  | 'configuring'
  | 'validating'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface UpdateResult {
  success: boolean;
  message: string;
  deviceUpdates: DeviceUpdateResult[];
}

export interface DeviceUpdateResult {
  device: Device;
  success: boolean;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  availableSpaceMB?: number;
  requiredSpaceMB?: number;
}

export interface WizardState {
  currentStep: number;
  selectedRelease: FirmwareRelease | null;
  selectedDevices: Device[];
  updateProgress: Map<string, UpdateProgress>;
  updateResult: UpdateResult | null;
  validationResults: Map<string, ValidationResult>;
}

// GitHub API Response Types
export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: GitHubAsset[];
}

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}
