import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

async function openPicker() {
  fireEvent.click(await screen.findByRole('button', { name: 'Change version' }));
  return screen.getByRole('dialog', { name: 'Choose a version' });
}

function row(dialog: HTMLElement, version: string) {
  return within(dialog).getByRole('listitem', { name: `Version ${version}` });
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

  it('starts on the newest stable release, shown compactly with a green Latest badge', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([beta, stable, older]);
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('2.0.4')).toHaveClass('code'));
    expect(screen.getByText('Latest').closest('.bb-badge')).toHaveClass('bb-badge--success');
    expect(screen.queryByText('2.0.3')).toBeNull();
  });

  it('lists every version in a dialog and closes it after choosing one', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([beta, stable, older]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const dialog = await openPicker();
    expect(within(dialog).queryByText('2.1.0-beta')).toBeNull();
    expect(within(row(dialog, '2.0.4')).getByText('Latest')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose version 2.0.3' }));
    expect(onChange).toHaveBeenLastCalledWith(older);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('2.0.3')).toBeInTheDocument();
  });

  it('marks the current choice in the list instead of offering Choose', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([stable, older]);
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('2.0.4')).toBeInTheDocument());
    const dialog = await openPicker();
    expect(within(row(dialog, '2.0.4')).getByText('Chosen')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Choose version 2.0.4' })).toBeNull();
  });

  it('shows experimental versions from the switch at the top of the dialog', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([beta, stable, older]);
    render(<Harness />);
    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Show experimental versions' }));
    const betaRow = row(dialog, '2.1.0-beta');
    expect(within(betaRow).getByText('Experimental')).toBeInTheDocument();
    expect(within(betaRow).queryByText('Latest')).toBeNull();
  });

  it('falls back to the newest stable when the chosen experimental version is hidden again', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([beta, stable]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const dialog = await openPicker();
    const toggle = within(dialog).getByRole('switch', { name: 'Show experimental versions' });
    fireEvent.click(toggle);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose version 2.1.0-beta' }));
    const reopened = await openPicker();
    fireEvent.click(within(reopened).getByRole('switch', { name: 'Show experimental versions' }));
    expect(onChange).toHaveBeenLastCalledWith(stable);
  });

  it('opens release notes inside a row, with underlined links', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([stable]);
    render(<Harness />);
    const dialog = await openPicker();
    const notes = within(row(dialog, '2.0.4')).getByRole('button', { name: 'Release notes' });
    expect(notes).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(notes);
    expect(notes).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('link', { name: 'docs' }).closest('.release-notes')).not.toBeNull();
  });

  it('deletes a download from its row only after confirming', async () => {
    const cached = { ...stable, isCached: true, cachedEntries: [createMockCachedMetadata({ version: '2.0.4' })] };
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([cached, older]);
    render(<Harness />);
    const dialog = await openPicker();
    expect(within(row(dialog, '2.0.4')).getByText('Downloaded')).toBeInTheDocument();
    expect(within(row(dialog, '2.0.3')).queryByRole('button', { name: /Delete download/ })).toBeNull();
    fireEvent.click(within(row(dialog, '2.0.4')).getByRole('button', { name: 'Delete download of version 2.0.4' }));
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
    expect(await screen.findByRole('button', { name: 'Change version' })).toBeInTheDocument();
  });

  it('returns focus to Change version when the dialog closes', async () => {
    vi.mocked(firmwareService.fetchReleases).mockResolvedValue([stable, older]);
    render(<Harness />);
    const trigger = await screen.findByRole('button', { name: 'Change version' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Choose a version' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose version 2.0.3' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change version' })).toHaveFocus());
  });
});
