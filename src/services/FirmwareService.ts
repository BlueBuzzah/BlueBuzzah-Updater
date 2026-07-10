import {
    BoardType,
    CachedFirmwareMetadata,
    FirmwareAsset,
    FirmwareBundle,
    FirmwareCacheIndex,
    FirmwareRelease,
    GitHubRelease,
} from '@/types';
import { invoke } from '@tauri-apps/api/core';

/** v2 (nRF52840) Nordic DFU package. */
export const NRF_ASSET_PATTERN = /^BlueBuzzah-Firmware-(?!v3-)/;
/** v3 (ESP32-S3 / PentaBuzzer) esptool image package. */
export const V3_ASSET_PATTERN = /^BlueBuzzah-Firmware-v3-/;

export function getAssetForBoard(
  release: FirmwareRelease,
  board: BoardType
): FirmwareAsset | null {
  const pattern = board === 'esp32s3' ? V3_ASSET_PATTERN : NRF_ASSET_PATTERN;
  return (
    release.assets.find((a) => pattern.test(a.name) && a.name.endsWith('.zip')) ?? null
  );
}

export interface IFirmwareRepository {
  fetchReleases(): Promise<FirmwareRelease[]>;
  downloadFirmware(release: FirmwareRelease, board?: BoardType): Promise<FirmwareBundle>;
  getCachedFirmware(version: string, board: BoardType): Promise<string | null>;
  getCacheIndex(): Promise<FirmwareCacheIndex>;
  deleteCachedFirmware(version: string, board: BoardType): Promise<void>;
  clearAllCache(): Promise<void>;
  verifyCachedFirmware(version: string, board: BoardType): Promise<boolean>;
  verifyAndCleanCache(): Promise<string[]>;
}

export class FirmwareService implements IFirmwareRepository {
  private readonly GITHUB_API_URL =
    'https://api.github.com/repos/BlueBuzzah/BlueBuzzah-Firmware/releases';

  async fetchReleases(): Promise<FirmwareRelease[]> {
    try {
      // Verify and clean stale cache entries before loading
      await this.verifyAndCleanCache();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      let response: Response;
      try {
        response = await fetch(this.GITHUB_API_URL, { signal: controller.signal });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new Error('Request timed out while fetching firmware releases. Check your internet connection and try again.');
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status === 403 || response.status === 429) {
        const resetHeader = response.headers.get('X-RateLimit-Reset');
        if (resetHeader) {
          const resetTime = new Date(parseInt(resetHeader, 10) * 1000);
          const waitMinutes = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 60_000));
          throw new Error(`GitHub API rate limit exceeded. Try again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.`);
        }
        throw new Error('GitHub API rate limit exceeded. Try again later.');
      }

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const releases: GitHubRelease[] = await response.json();

      // Get cache index to mark cached releases
      const cacheIndex = await this.getCacheIndex();

      // Group cached entries by version (a version may have multiple cached boards)
      const cacheByVersion = new Map<string, CachedFirmwareMetadata[]>();
      for (const meta of Object.values(cacheIndex)) {
        const list = cacheByVersion.get(meta.version) ?? [];
        list.push(meta);
        cacheByVersion.set(meta.version, list);
      }
      // The index is a Rust HashMap whose ordering changes between runs;
      // sort so entries[0] (used for the cached badge/hash) is deterministic,
      // nrf52 first.
      for (const list of cacheByVersion.values()) {
        list.sort((a, b) =>
          a.board === b.board ? 0 : a.board === 'nrf52' ? -1 : 1
        );
      }

      // Map GitHub releases and mark cached ones
      const githubVersions = new Set<string>();
      const firmwareReleases = releases.map((release) => {
        const transformed = this.transformRelease(release);
        githubVersions.add(transformed.version);
        const entries = cacheByVersion.get(transformed.version);

        if (entries && entries.length > 0) {
          return {
            ...transformed,
            isCached: true,
            cachedEntries: entries,
            cachedMetadata: entries[0],
            sha256Hash: entries[0].sha256_hash,
          };
        }

        return transformed;
      });

      // Add cached-only releases (not in GitHub response) — one release per version
      for (const [version, entries] of cacheByVersion.entries()) {
        if (!githubVersions.has(version)) {
          const first = entries[0];
          // Create release from cached metadata
          const cachedRelease: FirmwareRelease = {
            version,
            tagName: first.tag_name,
            releaseNotes: first.release_notes,
            publishedAt: first.published_at
              ? new Date(first.published_at)
              : new Date(first.downloaded_at),
            downloadUrl: '', // No URL for cached-only
            assets: entries.map((m) => ({
              name: `${version}${m.board === 'nrf52' ? '' : `-${m.board}`}.zip`,
              downloadUrl: '',
              size: m.file_size,
            })),
            isCached: true,
            cachedEntries: entries,
            cachedMetadata: first,
            sha256Hash: first.sha256_hash,
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

  async downloadFirmware(
    release: FirmwareRelease,
    board: BoardType = 'nrf52'
  ): Promise<FirmwareBundle> {
    try {
      // Check if firmware is already cached
      const cachedPath = await this.getCachedFirmware(release.version, board);

      if (cachedPath) {
        return {
          version: release.version,
          localPath: cachedPath,
          board,
        };
      }

      // Find the firmware zip asset matching the target board
      const firmwareAsset = getAssetForBoard(release, board);

      if (!firmwareAsset) {
        // Cached-only releases synthesize assets with no download URL; their
        // real cause is "not in the last GitHub fetch", not a missing asset.
        const cachedOnly =
          release.assets.length > 0 && release.assets.every((a) => !a.downloadUrl);
        if (cachedOnly) {
          throw new Error(
            `This version is only available from the local cache, which has no ${
              board === 'esp32s3' ? 'v3 (PentaBuzzer)' : 'v2 (nRF52840)'
            } firmware for it. The release could not be found on GitHub.`
          );
        }
        throw new Error(
          board === 'esp32s3'
            ? 'This release has no v3 (PentaBuzzer) firmware asset. It may predate v3 support.'
            : 'No v2 (nRF52840) firmware asset found in this release.'
        );
      }

      // Download firmware using Tauri command with metadata
      const localPath = await invoke<string>('download_firmware', {
        url: firmwareAsset.downloadUrl,
        version: release.version,
        board,
        tagName: release.tagName,
        publishedAt: release.publishedAt.toISOString(),
        releaseNotes: release.releaseNotes,
      });

      return {
        version: release.version,
        localPath,
        board,
      };
    } catch (error) {
      console.error('Failed to download firmware:', error);
      throw new Error(
        `Failed to download firmware: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async getCachedFirmware(version: string, board: BoardType): Promise<string | null> {
    try {
      const result = await invoke<string | null>('get_cached_firmware', {
        version,
        board,
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

  async deleteCachedFirmware(version: string, board: BoardType): Promise<void> {
    try {
      await invoke('delete_cached_firmware', { version, board });
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

  async verifyCachedFirmware(version: string, board: BoardType): Promise<boolean> {
    try {
      const result = await invoke<boolean>('verify_cached_firmware', {
        version,
        board,
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
      downloadUrl:
        githubRelease.assets.find(
          (a) => NRF_ASSET_PATTERN.test(a.name) && a.name.endsWith('.zip')
        )?.browser_download_url || '',
      assets: githubRelease.assets.map((asset) => ({
        name: asset.name,
        downloadUrl: asset.browser_download_url,
        size: asset.size,
      })),
      isPrerelease: githubRelease.prerelease,
    };
  }
}

// Singleton instance
export const firmwareService = new FirmwareService();
