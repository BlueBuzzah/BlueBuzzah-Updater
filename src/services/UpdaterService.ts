import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { AppUpdateInfo, AppUpdateProgress } from '@/types';

export interface IUpdaterRepository {
  checkForUpdate(): Promise<AppUpdateInfo | null>;
  downloadAndInstall(
    onProgress?: (progress: AppUpdateProgress) => void
  ): Promise<void>;
  relaunchApp(): Promise<void>;
}

export class UpdaterService implements IUpdaterRepository {
  private currentUpdate: Update | null = null;

  async checkForUpdate(): Promise<AppUpdateInfo | null> {
    try {
      const update = await check();

      if (!update) {
        this.currentUpdate = null;
        return null;
      }

      this.currentUpdate = update;

      return {
        version: update.version,
        currentVersion: update.currentVersion,
        releaseNotes: update.body || 'No release notes available.',
        releaseDate: update.date || null,
      };
    } catch (error) {
      console.error('Failed to check for updates:', error);
      throw new Error(
        `Failed to check for updates: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async downloadAndInstall(
    onProgress?: (progress: AppUpdateProgress) => void
  ): Promise<void> {
    if (!this.currentUpdate) {
      throw new Error('No update available to install');
    }

    try {
      let downloaded = 0;
      let total = 0;

      await this.currentUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength ?? 0;
            onProgress?.({
              stage: 'downloading',
              downloaded: 0,
              total,
              percent: 0,
            });
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            const percent =
              total > 0 ? Math.round((downloaded / total) * 100) : 0;
            onProgress?.({
              stage: 'downloading',
              downloaded,
              total,
              percent,
            });
            break;
          case 'Finished':
            onProgress?.({
              stage: 'ready',
              downloaded: total,
              total,
              percent: 100,
            });
            break;
        }
      });
    } catch (error) {
      console.error('Failed to download and install update:', error);
      throw new Error(
        `Failed to install update: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async relaunchApp(): Promise<void> {
    try {
      await relaunch();
    } catch (error) {
      console.error('Failed to relaunch app:', error);
      throw new Error(
        `Failed to relaunch: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Singleton instance
export const updaterService = new UpdaterService();
