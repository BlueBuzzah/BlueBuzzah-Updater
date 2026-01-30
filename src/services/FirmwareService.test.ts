import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { FirmwareService } from './FirmwareService';
import {
  createMockGitHubRelease,
  createMockGitHubAsset,
  createMockRelease,
  createMockCachedMetadata,
} from '@/test/factories';
import { mockConsole } from '@/test/setup';

// Note: Tauri API is mocked in test/setup.ts

describe('FirmwareService', () => {
  let service: FirmwareService;

  beforeEach(() => {
    service = new FirmwareService();
    vi.resetAllMocks();
  });

  describe('fetchReleases', () => {
    it('returns parsed releases from GitHub API', async () => {
      const mockGitHubReleases = [
        createMockGitHubRelease({ name: '1.0.0', tag_name: 'v1.0.0' }),
        createMockGitHubRelease({ name: '0.9.0', tag_name: 'v0.9.0' }),
      ];

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGitHubReleases),
      } as Response);

      // Mock verify_and_clean_cache and get_cache_index
      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache
      vi.mocked(invoke).mockResolvedValueOnce({}); // get_cache_index

      const releases = await service.fetchReleases();

      expect(releases).toHaveLength(2);
      expect(releases[0].version).toBe('1.0.0');
      expect(releases[1].version).toBe('0.9.0');
    });

    it('maps GitHub release to FirmwareRelease type', async () => {
      const mockGitHubRelease = createMockGitHubRelease({
        name: '2.0.0',
        tag_name: 'v2.0.0',
        body: 'New features',
        published_at: '2024-06-01T00:00:00Z',
        assets: [
          createMockGitHubAsset({
            name: 'firmware.zip',
            browser_download_url: 'https://test.com/firmware.zip',
            size: 5000,
          }),
        ],
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitHubRelease]),
      } as Response);

      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache
      vi.mocked(invoke).mockResolvedValueOnce({}); // get_cache_index

      const releases = await service.fetchReleases();

      expect(releases[0]).toMatchObject({
        version: '2.0.0',
        tagName: 'v2.0.0',
        releaseNotes: 'New features',
        assets: expect.arrayContaining([
          expect.objectContaining({
            name: 'firmware.zip',
            downloadUrl: 'https://test.com/firmware.zip',
            size: 5000,
          }),
        ]),
      });
      expect(releases[0].publishedAt).toBeInstanceOf(Date);
    });

    it('handles empty releases array', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache
      vi.mocked(invoke).mockResolvedValueOnce({}); // get_cache_index

      const releases = await service.fetchReleases();

      expect(releases).toEqual([]);
    });

    it('handles API error (network failure)', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache

      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'));

      await expect(service.fetchReleases()).rejects.toThrow('Failed to fetch firmware releases');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to fetch releases:',
        expect.any(Error)
      );
    });

    it('handles API error (non-ok response)', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as Response);

      await expect(service.fetchReleases()).rejects.toThrow('GitHub API error');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to fetch releases:',
        expect.any(Error)
      );
    });

    it('handles rate limiting response (429)', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        statusText: 'Too Many Requests',
        status: 429,
        headers: new Headers(),
      } as Response);

      await expect(service.fetchReleases()).rejects.toThrow('GitHub API rate limit exceeded. Try again later.');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to fetch releases:',
        expect.any(Error)
      );
    });

    it('handles 403 rate limit with X-RateLimit-Reset header', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache

      const resetTimestamp = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({
          'X-RateLimit-Reset': String(resetTimestamp),
        }),
      } as Response);

      await expect(service.fetchReleases()).rejects.toThrow(/GitHub API rate limit exceeded.*minute/);
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to fetch releases:',
        expect.any(Error)
      );
    });

    it('handles 403 rate limit without reset header', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers(),
      } as Response);

      await expect(service.fetchReleases()).rejects.toThrow('GitHub API rate limit exceeded. Try again later.');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to fetch releases:',
        expect.any(Error)
      );
    });

    it('handles fetch timeout via AbortController', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache

      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      vi.mocked(global.fetch).mockRejectedValueOnce(abortError);

      await expect(service.fetchReleases()).rejects.toThrow('Request timed out while fetching firmware releases');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to fetch releases:',
        expect.any(Error)
      );
    });

    it('sorts releases by date (newest first)', async () => {
      const oldRelease = createMockGitHubRelease({
        name: '0.5.0',
        published_at: '2023-01-01T00:00:00Z',
      });
      const newRelease = createMockGitHubRelease({
        name: '2.0.0',
        published_at: '2024-12-01T00:00:00Z',
      });
      const midRelease = createMockGitHubRelease({
        name: '1.0.0',
        published_at: '2024-06-01T00:00:00Z',
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([oldRelease, newRelease, midRelease]),
      } as Response);

      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache
      vi.mocked(invoke).mockResolvedValueOnce({}); // get_cache_index

      const releases = await service.fetchReleases();

      expect(releases[0].version).toBe('2.0.0');
      expect(releases[1].version).toBe('1.0.0');
      expect(releases[2].version).toBe('0.5.0');
    });

    it('marks releases that are cached', async () => {
      const mockGitHubRelease = createMockGitHubRelease({
        name: '1.0.0',
        tag_name: 'v1.0.0',
      });

      const mockCacheIndex = {
        '1.0.0': createMockCachedMetadata({ version: '1.0.0' }),
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitHubRelease]),
      } as Response);

      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache
      vi.mocked(invoke).mockResolvedValueOnce(mockCacheIndex); // get_cache_index

      const releases = await service.fetchReleases();

      expect(releases[0].isCached).toBe(true);
      expect(releases[0].cachedMetadata).toBeDefined();
    });

    it('includes cached-only releases not in GitHub response', async () => {
      const mockGitHubRelease = createMockGitHubRelease({
        name: '2.0.0',
        tag_name: 'v2.0.0',
      });

      const mockCacheIndex = {
        '1.0.0': createMockCachedMetadata({
          version: '1.0.0',
          published_at: '2024-01-01T00:00:00Z',
        }),
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([mockGitHubRelease]),
      } as Response);

      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache
      vi.mocked(invoke).mockResolvedValueOnce(mockCacheIndex); // get_cache_index

      const releases = await service.fetchReleases();

      expect(releases).toHaveLength(2);
      expect(releases.find((r) => r.version === '1.0.0')).toBeDefined();
      expect(releases.find((r) => r.version === '1.0.0')?.isCached).toBe(true);
    });

    it('uses release name as version, falls back to tag_name', async () => {
      const releaseWithName = createMockGitHubRelease({
        name: 'Release Name',
        tag_name: 'v1.0.0',
      });
      const releaseWithoutName = createMockGitHubRelease({
        name: '',
        tag_name: 'v0.9.0',
      });

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([releaseWithName, releaseWithoutName]),
      } as Response);

      vi.mocked(invoke).mockResolvedValueOnce([]); // verify_and_clean_cache
      vi.mocked(invoke).mockResolvedValueOnce({}); // get_cache_index

      const releases = await service.fetchReleases();

      expect(releases.find((r) => r.version === 'Release Name')).toBeDefined();
      expect(releases.find((r) => r.version === 'v0.9.0')).toBeDefined();
    });
  });

  describe('downloadFirmware', () => {
    it('calls invoke with correct command and params', async () => {
      const release = createMockRelease({
        version: '1.0.0',
        tagName: 'v1.0.0',
        releaseNotes: 'Test notes',
        publishedAt: new Date('2024-01-15'),
        assets: [
          {
            name: 'firmware.zip',
            downloadUrl: 'https://test.com/firmware.zip',
            size: 1000,
          },
        ],
      });

      vi.mocked(invoke)
        .mockResolvedValueOnce(null) // get_cached_firmware
        .mockResolvedValueOnce('/cache/firmware/v1.0.0'); // download_firmware

      await service.downloadFirmware(release);

      expect(invoke).toHaveBeenCalledWith('download_firmware', {
        url: 'https://test.com/firmware.zip',
        version: '1.0.0',
        tagName: 'v1.0.0',
        publishedAt: expect.any(String),
        releaseNotes: 'Test notes',
      });
    });

    it('returns local path on success', async () => {
      const release = createMockRelease();

      vi.mocked(invoke)
        .mockResolvedValueOnce(null) // get_cached_firmware
        .mockResolvedValueOnce('/cache/firmware/v1.0.0'); // download_firmware

      const result = await service.downloadFirmware(release);

      expect(result).toEqual({
        version: '1.0.0',
        localPath: '/cache/firmware/v1.0.0',
      });
    });

    it('returns cached path when firmware is already cached', async () => {
      const release = createMockRelease({ version: '1.0.0' });

      vi.mocked(invoke).mockResolvedValueOnce('/cache/firmware/v1.0.0'); // get_cached_firmware returns path

      const result = await service.downloadFirmware(release);

      expect(result.localPath).toBe('/cache/firmware/v1.0.0');
      // Should only call get_cached_firmware, not download_firmware
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('handles download failure', async () => {
      const release = createMockRelease();

      vi.mocked(invoke)
        .mockResolvedValueOnce(null) // get_cached_firmware
        .mockRejectedValueOnce(new Error('Download failed')); // download_firmware

      await expect(service.downloadFirmware(release)).rejects.toThrow(
        'Failed to download firmware'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to download firmware:',
        expect.any(Error)
      );
    });

    it('throws error if no zip asset found', async () => {
      const release = createMockRelease({
        assets: [{ name: 'readme.md', downloadUrl: 'https://test.com/readme', size: 100 }],
      });

      vi.mocked(invoke).mockResolvedValueOnce(null); // get_cached_firmware

      await expect(service.downloadFirmware(release)).rejects.toThrow(
        'No firmware zip file found'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to download firmware:',
        expect.any(Error)
      );
    });

    it('handles network timeout', async () => {
      const release = createMockRelease();

      vi.mocked(invoke)
        .mockResolvedValueOnce(null) // get_cached_firmware
        .mockRejectedValueOnce(new Error('Network timeout')); // download_firmware

      await expect(service.downloadFirmware(release)).rejects.toThrow(
        'Failed to download firmware: Network timeout'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to download firmware:',
        expect.any(Error)
      );
    });
  });

  describe('getCachedFirmware', () => {
    it('returns cached path when available', async () => {
      vi.mocked(invoke).mockResolvedValueOnce('/cache/firmware/v1.0.0');

      const result = await service.getCachedFirmware('1.0.0');

      expect(result).toBe('/cache/firmware/v1.0.0');
      expect(invoke).toHaveBeenCalledWith('get_cached_firmware', { version: '1.0.0' });
    });

    it('returns null when not cached', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null);

      const result = await service.getCachedFirmware('1.0.0');

      expect(result).toBeNull();
    });

    it('returns null on cache read error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Cache read failed'));

      const result = await service.getCachedFirmware('1.0.0');

      expect(result).toBeNull();
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to check cached firmware:',
        expect.any(Error)
      );
    });
  });

  describe('getCacheIndex', () => {
    it('returns cache index', async () => {
      const mockIndex = {
        '1.0.0': createMockCachedMetadata({ version: '1.0.0' }),
        '2.0.0': createMockCachedMetadata({ version: '2.0.0' }),
      };

      vi.mocked(invoke).mockResolvedValueOnce(mockIndex);

      const result = await service.getCacheIndex();

      expect(result).toEqual(mockIndex);
      expect(invoke).toHaveBeenCalledWith('get_cache_index');
    });

    it('returns empty object on error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Failed'));

      const result = await service.getCacheIndex();

      expect(result).toEqual({});
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to get cache index:',
        expect.any(Error)
      );
    });
  });

  describe('deleteCachedFirmware', () => {
    it('calls delete_cached_firmware command', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.deleteCachedFirmware('1.0.0');

      expect(invoke).toHaveBeenCalledWith('delete_cached_firmware', { version: '1.0.0' });
    });

    it('throws error on failure', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Delete failed'));

      await expect(service.deleteCachedFirmware('1.0.0')).rejects.toThrow(
        'Failed to delete cached firmware'
      );
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to delete cached firmware:',
        expect.any(Error)
      );
    });
  });

  describe('clearAllCache', () => {
    it('calls clear_all_cache command', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await service.clearAllCache();

      expect(invoke).toHaveBeenCalledWith('clear_all_cache');
    });

    it('throws error on failure', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Clear failed'));

      await expect(service.clearAllCache()).rejects.toThrow('Failed to clear cache');
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to clear cache:',
        expect.any(Error)
      );
    });
  });

  describe('verifyCachedFirmware', () => {
    it('returns true when firmware is valid', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(true);

      const result = await service.verifyCachedFirmware('1.0.0');

      expect(result).toBe(true);
      expect(invoke).toHaveBeenCalledWith('verify_cached_firmware', { version: '1.0.0' });
    });

    it('returns false when firmware is invalid', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(false);

      const result = await service.verifyCachedFirmware('1.0.0');

      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Verify failed'));

      const result = await service.verifyCachedFirmware('1.0.0');

      expect(result).toBe(false);
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to verify cached firmware:',
        expect.any(Error)
      );
    });
  });

  describe('verifyAndCleanCache', () => {
    it('returns removed versions', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(['1.0.0', '2.0.0']);

      const result = await service.verifyAndCleanCache();

      expect(result).toEqual(['1.0.0', '2.0.0']);
      expect(invoke).toHaveBeenCalledWith('verify_and_clean_cache');
    });

    it('returns empty array on success with no removals', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([]);

      const result = await service.verifyAndCleanCache();

      expect(result).toEqual([]);
    });

    it('returns empty array on error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(new Error('Failed'));

      const result = await service.verifyAndCleanCache();

      expect(result).toEqual([]);
      expect(mockConsole.error).toHaveBeenCalledWith(
        'Failed to verify and clean cache:',
        expect.any(Error)
      );
    });
  });
});
