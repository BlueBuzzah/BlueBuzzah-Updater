import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { FirmwareSelection } from './FirmwareSelection';
import { firmwareService } from '@/services/FirmwareService';
import { createMockCachedMetadata, createMockRelease } from '@/test/factories';
import type { FirmwareRelease } from '@/types';

// Mock the firmware service (keep the real getAssetForBoard helper)
vi.mock('@/services/FirmwareService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/FirmwareService')>();
  return {
    ...actual,
    firmwareService: { fetchReleases: vi.fn(), deleteCachedFirmware: vi.fn() },
  };
});

const beta = createMockRelease({ version: '2.1.0-beta', tagName: 'v2.1.0-beta', isPrerelease: true, releaseNotes: 'Beta notes' });
const stable = createMockRelease({ version: '2.0.4', tagName: 'v2.0.4', releaseNotes: 'Fixes **pairing**. See [docs](https://example.com).' });
const older = createMockRelease({ version: '2.0.3', tagName: 'v2.0.3' });

function Harness({ onChange = vi.fn() }: { onChange?: (r: FirmwareRelease | null) => void }) {
  const [value, setValue] = useState<FirmwareRelease | null>(null);
  return (
    <FirmwareSelection
      value={value}
      onChange={(r) => {
        onChange(r);
        setValue(r);
      }}
    />
  );
}

describe('FirmwareSelection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('says it is loading', () => {
    vi.mocked(firmwareService.fetchReleases).mockImplementation(() => new Promise(() => {}));
    render(<Harness />);
    expect(screen.getByText('Loading firmware versions…')).toBeInTheDocument();
  });

  it('preselects the newest stable release and marks it Latest', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([beta, stable, older]);
    render(<Harness />);
    const group = await screen.findByRole('radiogroup', { name: 'Choose a version' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /2\.0\.4/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: /2\.1\.0-beta/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /2\.0\.4/ })).toHaveTextContent('Latest');
  });

  it('keeps the stable choice and the Latest badge when experimental versions are shown', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([beta, stable, older]);
    render(<Harness />);
    await screen.findByRole('radiogroup');
    fireEvent.click(screen.getByRole('switch', { name: 'Show experimental versions' }));
    const betaRadio = screen.getByRole('radio', { name: /2\.1\.0-beta/ });
    expect(betaRadio).toHaveTextContent('Experimental');
    expect(betaRadio).not.toHaveTextContent('Latest');
    expect(screen.getByRole('radio', { name: /2\.0\.4/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('falls back to the newest stable when the chosen experimental version is hidden again', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([beta, stable]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await screen.findByRole('radiogroup');
    fireEvent.click(screen.getByRole('switch', { name: 'Show experimental versions' }));
    fireEvent.click(screen.getByRole('radio', { name: /2\.1\.0-beta/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Show experimental versions' }));
    expect(onChange).toHaveBeenLastCalledWith(stable);
  });

  it('shows release notes for the chosen version behind a disclosure, with underlined links', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([stable]);
    render(<Harness />);
    const toggle = await screen.findByRole('button', { name: 'Show release notes' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide release notes' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'docs' }).closest('.release-notes')).not.toBeNull();
  });

  it('deletes a download only after confirming', async () => {
    const cached = { ...stable, isCached: true, cachedEntries: [createMockCachedMetadata({ version: '2.0.4' })] };
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([cached]);
    render(<Harness />);
    expect(await screen.findByRole('radio', { name: /2\.0\.4/ })).toHaveTextContent('Downloaded');
    fireEvent.click(screen.getByRole('button', { name: 'Delete download' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete this download?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(firmwareService.deleteCachedFirmware).toHaveBeenCalledWith('2.0.4', 'nrf52'));
  });

  it('offers Try again when nothing can be loaded', async () => {
    vi.mocked(firmwareService.fetchReleases).mockRejectedValueOnce(new Error('rate limited')).mockResolvedValueOnce([stable]);
    render(<Harness />);
    expect(await screen.findByText('No firmware found')).toBeInTheDocument();
    expect(screen.getByText('rate limited')).toHaveClass('code-s');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: /2\.0\.4/ })).toBeInTheDocument();
  });
});
