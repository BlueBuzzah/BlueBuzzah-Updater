import { invoke } from '@tauri-apps/api/core';
import {
  FirmwareRelease,
  FirmwareBundle,
  GitHubRelease,
} from '@/types';

export interface IFirmwareRepository {
  fetchReleases(): Promise<FirmwareRelease[]>;
  downloadFirmware(release: FirmwareRelease): Promise<FirmwareBundle>;
  getCachedFirmware(version: string): Promise<string | null>;
}

export class FirmwareService implements IFirmwareRepository {
  private readonly GITHUB_API_URL =
    'https://api.github.com/repos/BlueBuzzah/BlueBuzzah2-Firmware/releases';

  async fetchReleases(): Promise<FirmwareRelease[]> {
    try {
      const response = await fetch(this.GITHUB_API_URL);

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const releases: GitHubRelease[] = await response.json();

      return releases.map((release) => this.transformRelease(release));
    } catch (error) {
      console.error('Failed to fetch releases:', error);
      throw new Error(
        `Failed to fetch firmware releases: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async downloadFirmware(release: FirmwareRelease): Promise<FirmwareBundle> {
    try {
      // Check if firmware is already cached
      const cachedPath = await this.getCachedFirmware(release.version);

      if (cachedPath) {
        return {
          version: release.version,
          localPath: cachedPath,
        };
      }

      // Find the firmware zip asset
      const firmwareAsset = release.assets.find((asset) =>
        asset.name.endsWith('.zip')
      );

      if (!firmwareAsset) {
        throw new Error('No firmware zip file found in release assets');
      }

      // Download firmware using Tauri command
      const localPath = await invoke<string>('download_firmware', {
        url: firmwareAsset.downloadUrl,
        version: release.version,
      });

      return {
        version: release.version,
        localPath,
      };
    } catch (error) {
      console.error('Failed to download firmware:', error);
      throw new Error(
        `Failed to download firmware: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getCachedFirmware(version: string): Promise<string | null> {
    try {
      const result = await invoke<string | null>('get_cached_firmware', {
        version,
      });
      return result;
    } catch (error) {
      console.error('Failed to check cached firmware:', error);
      return null;
    }
  }

  private transformRelease(githubRelease: GitHubRelease): FirmwareRelease {
    return {
      version: githubRelease.name || githubRelease.tag_name,
      tagName: githubRelease.tag_name,
      releaseNotes: githubRelease.body || 'No release notes available',
      publishedAt: new Date(githubRelease.published_at),
      downloadUrl: githubRelease.assets[0]?.browser_download_url || '',
      assets: githubRelease.assets.map((asset) => ({
        name: asset.name,
        downloadUrl: asset.browser_download_url,
        size: asset.size,
      })),
    };
  }
}

// Singleton instance
export const firmwareService = new FirmwareService();
