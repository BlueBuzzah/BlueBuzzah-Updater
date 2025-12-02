import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  Device,
  TherapyProfile,
  TherapyConfigProgress,
  TherapyConfigStage,
} from '@/types';

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
    case 'error':
      return 'error';
    default:
      return 'connecting';
  }
}

export interface ITherapyService {
  /**
   * Configure the therapy profile for a device.
   */
  configureProfile(
    device: Device,
    profile: TherapyProfile,
    onProgress?: (progress: TherapyConfigProgress) => void
  ): Promise<void>;
}

export class TherapyService implements ITherapyService {
  async configureProfile(
    device: Device,
    profile: TherapyProfile,
    onProgress?: (progress: TherapyConfigProgress) => void
  ): Promise<void> {
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

    // Call Tauri backend command
    await invoke('set_device_profile', {
      serialPort: device.path,
      profile: profile,
      progress: progressChannel,
    });
  }
}

export const therapyService = new TherapyService();
