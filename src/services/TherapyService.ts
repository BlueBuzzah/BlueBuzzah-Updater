import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  Device,
  TherapyProfile,
  TherapyConfigProgress,
  TherapyConfigStage,
  CustomProfileRead,
  ProfileConfigOutcome,
} from '@/types';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Progress event from the Rust backend.
 */
interface ProfileProgressEvent {
  stage: string;
  percent: number;
  message: string;
}

/**
 * Maps backend stage strings to TherapyConfigStage type.
 */
function mapBackendStage(stage: string): TherapyConfigStage {
  switch (stage) {
    case 'connecting':
      return 'connecting';
    case 'sending':
      return 'sending';
    case 'rebooting':
      return 'rebooting';
    case 'complete':
      return 'complete';
    case 'partial':
      return 'partial';
    case 'error':
      return 'error';
    default:
      return 'connecting';
  }
}

export interface ITherapyService {
  /**
   * Configure the therapy profile for a device.
   * Advanced settings — including custom profile parameters — are automatically
   * included from the settings store.
   */
  configureProfile(
    device: Device,
    profile: TherapyProfile,
    onProgress?: (progress: TherapyConfigProgress) => void
  ): Promise<ProfileConfigOutcome>;

  /**
   * Read Custom profile values from the first connected PRIMARY glove.
   * Never rejects for "nothing plugged in" — that is the 'no_device' case.
   */
  readCustomProfile(): Promise<CustomProfileRead>;
}

export class TherapyService implements ITherapyService {
  async configureProfile(
    device: Device,
    profile: TherapyProfile,
    onProgress?: (progress: TherapyConfigProgress) => void
  ): Promise<ProfileConfigOutcome> {
    // Create channel for progress updates from backend
    const progressChannel = new Channel<ProfileProgressEvent>();

    progressChannel.onmessage = (event) => {
      onProgress?.({
        devicePath: device.path,
        stage: mapBackendStage(event.stage),
        progress: event.percent,
        message: event.message,
      });
    };

    // Get current advanced settings from store
    const { settings } = useSettingsStore.getState();

    // Call Tauri backend command with settings
    return await invoke<ProfileConfigOutcome>('set_device_profile', {
      serialPort: device.path,
      profile: profile,
      advancedSettings: settings,
      progress: progressChannel,
    });
  }

  async readCustomProfile(): Promise<CustomProfileRead> {
    return await invoke<CustomProfileRead>('read_custom_profile');
  }
}

export const therapyService = new TherapyService();
