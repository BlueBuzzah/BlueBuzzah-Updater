import {
    FirmwareBundle,
    FirmwareCacheIndex,
    FirmwareRelease,
    GitHubRelease,
} from '@/types';
import { invoke } from '@tauri-apps/api/core';

export interface IFirmwareRepository {
  fetchReleases(): Promise<FirmwareRelease[]>;
  downloadFirmware(release: FirmwareRelease): Promise<FirmwareBundle>;
  getCachedFirmware(version: string): Promise<string | null>;
  getCacheIndex(): Promise<FirmwareCacheIndex>;
  deleteCachedFirmware(version: string): Promise<void>;
  clearAllCache(): Promise<void>;
  verifyCachedFirmware(version: string): Promise<boolean>;
  verifyAndCleanCache(): Promise<string[]>;
}

export class FirmwareService implements IFirmwareRepository {
  private readonly GITHUB_API_URL =
    'https://api.github.com/repos/BlueBuzzah/BlueBuzzah-Firmware/releases';

  async fetchReleases(): Promise<FirmwareRelease[]> {
    try {
      // Verify and clean stale cache entries before loading
      await this.verifyAndCleanCache();

      const response = await fetch(this.GITHUB_API_URL);

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const releases: GitHubRelease[] = await response.json();

      // Get cache index to mark cached releases
      const cacheIndex = await this.getCacheIndex();

      // Map GitHub releases and mark cached ones
      const githubVersions = new Set<string>();
      const firmwareReleases = releases.map((release) => {
        const transformed = this.transformRelease(release);
        githubVersions.add(transformed.version);
        const cachedMetadata = cacheIndex[transformed.version];

        if (cachedMetadata) {
          return {
            ...transformed,
            isCached: true,
            cachedMetadata,
            sha256Hash: cachedMetadata.sha256_hash,
          };
        }

        return transformed;
      });

      // Add cached-only releases (not in GitHub response)
      for (const [version, cachedMetadata] of Object.entries(cacheIndex)) {
        if (!githubVersions.has(version)) {
          // Create release from cached metadata
          const cachedRelease: FirmwareRelease = {
            version: cachedMetadata.version,
            tagName: cachedMetadata.tag_name,
            releaseNotes: cachedMetadata.release_notes,
            publishedAt: cachedMetadata.published_at
              ? new Date(cachedMetadata.published_at)
              : new Date(cachedMetadata.downloaded_at),
            downloadUrl: '', // No URL for cached-only
            assets: [
              {
                name: `${version}.zip`,
                downloadUrl: '',
                size: cachedMetadata.file_size,
              },
            ],
            isCached: true,
            cachedMetadata,
            sha256Hash: cachedMetadata.sha256_hash,
          };

          firmwareReleases.push(cachedRelease);
        }
      }

      // Sort by published date (newest first)
      firmwareReleases.sort(
        (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()
      );

      return firmwareReleases;
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

      // Download firmware using Tauri command with metadata
      const localPath = await invoke<string>('download_firmware', {
        url: firmwareAsset.downloadUrl,
        version: release.version,
        tagName: release.tagName,
        publishedAt: release.publishedAt.toISOString(),
        releaseNotes: release.releaseNotes,
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

  async getCacheIndex(): Promise<FirmwareCacheIndex> {
    try {
      const result = await invoke<FirmwareCacheIndex>('get_cache_index');
      return result;
    } catch (error) {
      console.error('Failed to get cache index:', error);
      return {};
    }
  }

  async deleteCachedFirmware(version: string): Promise<void> {
    try {
      await invoke('delete_cached_firmware', { version });
    } catch (error) {
      console.error('Failed to delete cached firmware:', error);
      throw new Error(
        `Failed to delete cached firmware: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async clearAllCache(): Promise<void> {
    try {
      await invoke('clear_all_cache');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      throw new Error(
        `Failed to clear cache: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async verifyCachedFirmware(version: string): Promise<boolean> {
    try {
      const result = await invoke<boolean>('verify_cached_firmware', {
        version,
      });
      return result;
    } catch (error) {
      console.error('Failed to verify cached firmware:', error);
      return false;
    }
  }

  async verifyAndCleanCache(): Promise<string[]> {
    try {
      const removedVersions = await invoke<string[]>('verify_and_clean_cache');
      if (removedVersions.length > 0) {
        console.log(
          `Cleaned ${removedVersions.length} stale cache entries:`,
          removedVersions
        );
      }
      return removedVersions;
    } catch (error) {
      console.error('Failed to verify and clean cache:', error);
      return [];
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
