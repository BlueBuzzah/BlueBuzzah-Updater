// Domain Models
export interface FirmwareRelease {
  version: string;
  tagName: string;
  releaseNotes: string;
  publishedAt: Date;
  downloadUrl: string;
  assets: FirmwareAsset[];
}

export interface FirmwareAsset {
  name: string;
  downloadUrl: string;
  size: number;
}

export interface Device {
  path: string;
  label: string;
  role?: DeviceRole;
  isCircuitPy: boolean;
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
}

export type UpdateStage =
  | 'downloading'
  | 'wiping'
  | 'copying'
  | 'configuring'
  | 'validating'
  | 'complete'
  | 'error';

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
