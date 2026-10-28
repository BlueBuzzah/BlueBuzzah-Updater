import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { therapyService } from '@/services/TherapyService';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTherapyStore } from '@/stores/therapyStore';
import { ProfileSelection } from './ProfileSelection';

vi.mock('@/services/TherapyService', () => ({
  therapyService: { readCustomProfile: vi.fn(), configureProfile: vi.fn() },
}));

describe('ProfileSelection', () => {
  beforeEach(() => {
    vi.mocked(therapyService.readCustomProfile).mockResolvedValue({ case: 'no_device', values: null, profileName: null, motors: null });
    useSettingsStore.setState({ settings: { disableLedDuringTherapy: false, debugMode: false, selectedProfile: null }, isLoaded: true, loadError: null });
    useTherapyStore.getState().reset();
  });

  it('offers the five patterns as a radio group in plain words', () => {
    render(<ProfileSelection />);
    const group = screen.getByRole('radiogroup', { name: 'Choose a pattern' });
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(group).not.toHaveTextContent(/therapeutic|stimulation|vCR|jitter/i);
  });

  it('arrow keys move the choice and store it for the configure step', () => {
    useSettingsStore.setState({ settings: { disableLedDuringTherapy: false, debugMode: false, selectedProfile: 'REGULAR' } });
    render(<ProfileSelection />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /^Regular/ }), { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /^Noisy/ })).toHaveAttribute('aria-checked', 'true');
    expect(useTherapyStore.getState().selectedProfile).toBe('NOISY');
    expect(useSettingsStore.getState().settings.selectedProfile).toBe('NOISY');
  });

  it('shows the custom settings only for Custom', () => {
    render(<ProfileSelection />);
    expect(screen.queryByText('Custom pattern')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Custom/ }));
    expect(screen.getByText('Custom pattern')).toBeInTheDocument();
  });

  it('shows device behavior switches without an Advanced toggle', () => {
    render(<ProfileSelection />);
    expect(screen.queryByText(/advanced/i)).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Turn off the light during sessions' }));
    expect(useSettingsStore.getState().settings.disableLedDuringTherapy).toBe(true);
    expect(screen.getByRole('switch', { name: 'Debug output' })).toHaveAccessibleDescription('Sends extra details over USB for troubleshooting.');
  });

  it('explains a settings load problem inline instead of a toast', () => {
    useSettingsStore.setState({ loadError: 'file locked' });
    render(<ProfileSelection />);
    expect(screen.getByText("We couldn't load your saved settings, so these are the defaults.")).toBeInTheDocument();
    expect(screen.getByText('file locked')).toHaveClass('code-s');
  });
});
