import type { CustomProfileParams } from '@/lib/therapy-bounds';

export type { CustomProfileParams };

// Domain Models

/** Hardware board family a firmware asset / device belongs to. */
export type BoardType = 'nrf52' | 'esp32s3';

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
  /** All cached board entries for this version (one per cached board). */
  cachedEntries?: CachedFirmwareMetadata[];
  isPrerelease?: boolean;
}

export interface FirmwareAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface CachedFirmwareMetadata {
  version: string;
  board: BoardType;
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
  board: BoardType; // Hardware family: v2 = 'nrf52', v3 = 'esp32s3'
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
  board: BoardType;
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

export interface AdvancedSettings {
  disableLedDuringTherapy: boolean;
  debugMode: boolean;
  /** Selected therapy profile, persisted for convenience */
  selectedProfile?: TherapyProfile | null;
  /**
   * Custom profile parameters, persisted so bench tuning survives a restart.
   * A successful read from a glove takes precedence over these — the device is
   * the source of truth for what is actually on the hardware.
   */
  customProfile?: CustomProfileParams;
}

export interface WizardState {
  currentStep: number;
  selectedRelease: FirmwareRelease | null;
  selectedDevices: Device[];
  updateProgress: Map<string, UpdateProgress>;
  updateResult: UpdateResult | null;
  validationResults: Map<string, ValidationResult>;
  logs: string[];
}

// GitHub API Response Types
export interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  assets: GitHubAsset[];
}

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

// ============================================================================
// Therapy Profile Types
// ============================================================================

export type TherapyProfile =
  | 'REGULAR'
  | 'NOISY'
  | 'HYBRID'
  | 'GENTLE'
  | 'CUSTOM';

export interface TherapyProfileInfo {
  id: TherapyProfile;
  name: string;
  description: string;
}

/** Which of the three prefill situations a glove read landed in. */
export type CustomProfileReadCase = 'custom' | 'not_custom' | 'no_device';

/**
 * Result of reading Custom parameters from a connected glove.
 *
 * `values` is populated ONLY for the 'custom' case. PROFILE_GET returns the
 * values of whatever profile is loaded without saying which profile they belong
 * to, so prefilling from a glove sitting on Regular would silently present
 * another profile's timings as the user's custom settings.
 */
export interface CustomProfileRead {
  case: CustomProfileReadCase;
  values: CustomProfileParams | null;
  /** Loaded profile name from INFO, e.g. "regular_vcr". Null when no device. */
  profileName: string | null;
  /** MAX_ACTUATORS reported by INFO. Null when no device. */
  motors: number | null;
}

/** The three distinct results of a Custom profile configuration attempt. */
export type ProfileConfigStatus = 'success' | 'success_secondary' | 'partial';

export interface ProfileConfigOutcome {
  status: ProfileConfigStatus;
  /** Short, human-readable line fit for a device card. */
  message: string;
  /**
   * Raw diagnostic text — the device's echoed serial output and the underlying
   * error. Belongs in the configuration log, never on a card: firmware
   * timeouts embed the entire boot stream, which is unreadable inline.
   */
  detail?: string | null;
}

export type TherapyConfigStage =
  | 'connecting'
  | 'sending'
  | 'rebooting'
  | 'complete'
  /** Profile changed, parameters unconfirmed — not a success. */
  | 'partial'
  | 'error';

export interface TherapyConfigProgress {
  devicePath: string;
  stage: TherapyConfigStage;
  progress: number;
  message: string;
}

export interface TherapyConfigResult {
  success: boolean;
  message: string;
  deviceConfigs: DeviceConfigResult[];
}

export interface DeviceConfigResult {
  device: Device;
  success: boolean;
  profile?: TherapyProfile;
  error?: string;
  /** Present when the backend reported a distinct outcome (Custom profile). */
  outcome?: ProfileConfigOutcome;
}

export interface TherapyState {
  step: number;
  selectedProfile: TherapyProfile | null;
  selectedDevices: Device[];
  progress: Map<string, TherapyConfigProgress>;
  result: TherapyConfigResult | null;
  logs: string[];
}

// ============================================================================
// App Updater Types
// ============================================================================

export type AppUpdateStage =
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface AppUpdateInfo {
  version: string;
  currentVersion: string;
  releaseNotes: string;
  releaseDate: string | null;
}

export interface AppUpdateProgress {
  stage: AppUpdateStage;
  downloaded: number;
  total: number;
  percent: number;
}

export type UpdaterErrorStage = 'check' | 'download' | 'install' | 'relaunch';

export interface UpdaterErrorInfo {
  message: string;
  details: string;
  stage: UpdaterErrorStage;
}

export interface UpdaterState {
  isChecking: boolean;
  updateAvailable: boolean;
  updateInfo: AppUpdateInfo | null;
  progress: AppUpdateProgress | null;
  error: UpdaterErrorInfo | null;
  dismissed: boolean;
}
