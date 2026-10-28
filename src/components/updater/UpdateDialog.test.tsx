import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateDialog } from './UpdateDialog';
import { useUpdaterStore } from '@/stores/updaterStore';
import { useWizardStore } from '@/stores/wizardStore';
import { updaterService } from '@/services/UpdaterService';

vi.mock('@/services/UpdaterService', async (orig) => ({
  ...(await orig<typeof import('@/services/UpdaterService')>()),
  updaterService: { checkForUpdate: vi.fn(), downloadAndInstall: vi.fn(), relaunchApp: vi.fn() },
}));

const info = { version: '9.9.9', currentVersion: '1.0.0', releaseNotes: 'Faster flashing.', releaseDate: null };

describe('UpdateDialog', () => {
  beforeEach(() => {
    useUpdaterStore.getState().reset();
    useWizardStore.getState().reset();
  });

  // Radix's focus scope restores focus on a timer; let it run before the environment tears down.
  afterEach(async () => {
    await act(() => new Promise((r) => setTimeout(r, 20)));
  });

  it('offers the app update in plain words', () => {
    act(() => useUpdaterStore.getState().setUpdateAvailable(info));
    render(<UpdateDialog />);
    expect(screen.getByRole('alertdialog', { name: 'A New BlueBuzzah Updater Is Ready' })).toHaveTextContent('Version 9.9.9 is ready. You have 1.0.0.');
    expect(screen.getByText("What's new")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not Now' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows a failed install with next steps, the detail in code and a retry of the install', async () => {
    vi.mocked(updaterService.downloadAndInstall).mockRejectedValueOnce(new Error('signature mismatch')).mockResolvedValue(undefined);
    act(() => useUpdaterStore.getState().setUpdateAvailable(info));
    render(<UpdateDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Install and Restart' }));
    expect(await screen.findByText("The Update Didn't Install")).toBeInTheDocument();
    expect(screen.getByText('Check your internet connection, then select Try Again.')).toBeInTheDocument();
    expect(screen.getByText(/signature mismatch/)).toHaveClass('code-s');
    expect(screen.getByRole('button', { name: 'Copy Details' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    await waitFor(() => expect(updaterService.downloadAndInstall).toHaveBeenCalledTimes(2));
  });
});
