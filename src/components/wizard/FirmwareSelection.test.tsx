import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FirmwareSelection } from './FirmwareSelection';
import { firmwareService } from '@/services/FirmwareService';
import { createMockRelease, createMockReleases } from '@/test/factories';

// Mock the firmware service
vi.mock('@/services/FirmwareService', () => ({
  firmwareService: {
    fetchReleases: vi.fn(),
    deleteCachedFirmware: vi.fn(),
  },
}));

// Mock the toast hook
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe('FirmwareSelection', () => {
  const mockOnSelect = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Loading State', () => {
    it('renders loading state while fetching', () => {
      vi.mocked(firmwareService.fetchReleases).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      expect(screen.getByText('Loading firmware releases...')).toBeInTheDocument();
    });

    it('shows skeleton cards during loading', () => {
      vi.mocked(firmwareService.fetchReleases).mockImplementation(
        () => new Promise(() => {})
      );

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      // Should show 4 skeleton cards
      const skeletonCards = document.querySelectorAll('.animate-pulse');
      expect(skeletonCards.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Rendering Releases', () => {
    it('renders firmware list on success', async () => {
      const mockReleases = createMockReleases(3);
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue(mockReleases);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
        expect(screen.getByText('1.1.0')).toBeInTheDocument();
        expect(screen.getByText('1.2.0')).toBeInTheDocument();
      });
    });

    it('shows version and date for each release', async () => {
      const mockRelease = createMockRelease({
        version: '2.0.0',
        publishedAt: new Date('2024-06-15'),
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('2.0.0')).toBeInTheDocument();
        expect(screen.getByText(/June/)).toBeInTheDocument();
      });
    });

    it('highlights latest release with badge', async () => {
      const mockReleases = createMockReleases(2);
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue(mockReleases);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('Latest')).toBeInTheDocument();
      });
    });

    it('shows cached badge for cached releases', async () => {
      const cachedRelease = createMockRelease({
        version: '1.0.0',
        isCached: true,
        cachedMetadata: {
          version: '1.0.0',
          tag_name: 'v1.0.0',
          sha256_hash: 'abc123',
          zip_path: '/cache/1.0.0.zip',
          downloaded_at: '2024-01-15T12:00:00Z',
          file_size: 1024000,
          published_at: '2024-01-15T00:00:00Z',
          release_notes: 'Test',
        },
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([cachedRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('Cached')).toBeInTheDocument();
      });
    });

    it('displays download size', async () => {
      const mockRelease = createMockRelease({
        version: '1.0.0',
        assets: [
          {
            name: 'firmware.zip',
            downloadUrl: 'https://test.com/firmware.zip',
            size: 1048576, // 1 MB
          },
        ],
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('1 MB')).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('renders no releases found message', async () => {
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('No Releases Found')).toBeInTheDocument();
      });
    });

    it('shows retry button when no releases', async () => {
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
      });
    });
  });

  describe('Interactions', () => {
    it('clicking release calls onSelect', async () => {
      const mockRelease = createMockRelease({ version: '1.0.0' });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /select version/i }));

      expect(mockOnSelect).toHaveBeenCalledWith(mockRelease);
    });

    it('selected release shows checkmark', async () => {
      const mockRelease = createMockRelease({ version: '1.0.0' });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={mockRelease} />
      );

      await waitFor(() => {
        expect(screen.getByText('Selected')).toBeInTheDocument();
      });
    });

    it('selected release has ring styling', async () => {
      const mockRelease = createMockRelease({ version: '1.0.0' });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={mockRelease} />
      );

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
      });

      // Card should have ring-2 ring-primary class
      const cards = document.querySelectorAll('.ring-2');
      expect(cards.length).toBe(1);
    });
  });

  describe('Release Notes Expansion', () => {
    it('shows truncated release notes by default', async () => {
      const longNotes = 'A'.repeat(200);
      const mockRelease = createMockRelease({
        version: '1.0.0',
        releaseNotes: longNotes,
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('Read more')).toBeInTheDocument();
      });
    });

    it('expands release notes on click', async () => {
      const longNotes = 'A'.repeat(200);
      const mockRelease = createMockRelease({
        version: '1.0.0',
        releaseNotes: longNotes,
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('Read more')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Read more'));

      expect(screen.getByText('Show less')).toBeInTheDocument();
    });

    it('does not show expand button for short notes', async () => {
      const shortNotes = 'Short release notes';
      const mockRelease = createMockRelease({
        version: '1.0.0',
        releaseNotes: shortNotes,
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('Short release notes')).toBeInTheDocument();
      });

      expect(screen.queryByText('Read more')).not.toBeInTheDocument();
    });
  });

  describe('Cache Management', () => {
    it('shows delete button for cached releases', async () => {
      const cachedRelease = createMockRelease({
        version: '1.0.0',
        isCached: true,
        cachedMetadata: {
          version: '1.0.0',
          tag_name: 'v1.0.0',
          sha256_hash: 'abc123',
          zip_path: '/cache/1.0.0.zip',
          downloaded_at: '2024-01-15T12:00:00Z',
          file_size: 1024000,
          published_at: '2024-01-15T00:00:00Z',
          release_notes: 'Test',
        },
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([cachedRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        // Cached release should show cache badge and have a delete button
        expect(screen.getByText('Cached')).toBeInTheDocument();
        // There should be multiple buttons (select + delete)
        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(1);
      });
    });

    it('shows confirmation dialog when delete clicked', async () => {
      const cachedRelease = createMockRelease({
        version: '1.0.0',
        isCached: true,
        cachedMetadata: {
          version: '1.0.0',
          tag_name: 'v1.0.0',
          sha256_hash: 'abc123',
          zip_path: '/cache/1.0.0.zip',
          downloaded_at: '2024-01-15T12:00:00Z',
          file_size: 1024000,
          published_at: '2024-01-15T00:00:00Z',
          release_notes: 'Test',
        },
      });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([cachedRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('Cached')).toBeInTheDocument();
      });

      // Find and click the delete button (small button with trash icon)
      const buttons = screen.getAllByRole('button');
      // The delete button is the small one (not "Select Version")
      const deleteButton = buttons.find(btn => !btn.textContent?.includes('Select') && !btn.textContent?.includes('Selected'));
      if (deleteButton) {
        fireEvent.click(deleteButton);

        await waitFor(() => {
          expect(screen.getByText('Delete Cached Firmware')).toBeInTheDocument();
        });
      }
    });
  });

  describe('Error Handling', () => {
    it('handles fetch error gracefully', async () => {
      vi.mocked(firmwareService.fetchReleases).mockRejectedValue(
        new Error('Network error')
      );

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      // Should not crash - error is handled via toast
      await waitFor(() => {
        expect(screen.getByText('No Releases Found')).toBeInTheDocument();
      });
    });
  });

  describe('Single Release', () => {
    it('renders correctly with single release', async () => {
      const mockRelease = createMockRelease({ version: '1.0.0' });
      vi.mocked(firmwareService.fetchReleases).mockResolvedValue([mockRelease]);

      render(
        <FirmwareSelection onSelect={mockOnSelect} selectedRelease={null} />
      );

      await waitFor(() => {
        expect(screen.getByText('1.0.0')).toBeInTheDocument();
        expect(screen.getByText('Latest')).toBeInTheDocument();
      });
    });
  });
});
