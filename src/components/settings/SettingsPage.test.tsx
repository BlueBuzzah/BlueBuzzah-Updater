import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { useThemeStore } from '@/stores/themeStore';
import { useUpdaterStore } from '@/stores/updaterStore';
import { useTheme } from '@/hooks/useTheme';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('1.2.3') }));

function WithTheme() {
  useTheme();
  return <SettingsPage />;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    useThemeStore.setState({ appearance: 'system', highContrast: null });
    useUpdaterStore.getState().reset();
    delete document.documentElement.dataset.theme;
  });

  it('theme choices drive data-theme', () => {
    render(<WithTheme />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('switch', { name: 'High contrast' }));
    expect(document.documentElement.dataset.theme).toBe('light-hc');
    fireEvent.click(screen.getByRole('button', { name: "Use my computer's setting" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(screen.queryByRole('button', { name: "Use my computer's setting" })).toBeNull();
  });

  it('shows a failed launch check here, not in a dialog', () => {
    act(() => useUpdaterStore.getState().setCheckError({ message: 'offline', stage: 'check' } as never));
    render(<SettingsPage />);
    expect(screen.getByText("Couldn't check for updates. Check your internet connection, then try again.")).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the app version in code', async () => {
    render(<SettingsPage />);
    expect(await screen.findByText('1.2.3')).toHaveClass('code');
  });
});
