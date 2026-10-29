import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_DEFAULTS } from '@/lib/therapy-bounds';
import { therapyService } from '@/services/TherapyService';
import { useSettingsStore } from '@/stores/settingsStore';
import { CustomProfilePanel } from './CustomProfilePanel';

vi.mock('@/services/TherapyService', () => ({
  therapyService: { readCustomProfile: vi.fn(), configureProfile: vi.fn() },
}));

const mockRead = vi.mocked(therapyService.readCustomProfile);
const noDevice = { case: 'no_device' as const, values: null, profileName: null, motors: null };

function field(name: RegExp | string) {
  return screen.getByRole('textbox', { name });
}

describe('CustomProfilePanel', () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue(noDevice);
    useSettingsStore.setState({ settings: { disableLedDuringTherapy: false, debugMode: false } });
  });

  it('prefills from the Primary device and says so', async () => {
    mockRead.mockResolvedValue({ case: 'custom', values: { ...CUSTOM_DEFAULTS, on: 150 }, profileName: 'custom_vcr', motors: 4 });
    render(<CustomProfilePanel />);
    expect(await screen.findByText('Loaded from your Primary device.')).toBeInTheDocument();
    await waitFor(() => expect(field('Buzz length')).toHaveValue('150'));
  });

  it('explains that defaults are shown when the device runs another pattern', async () => {
    mockRead.mockResolvedValue({ case: 'not_custom', values: null, profileName: 'noisy_vcr', motors: 4 });
    render(<CustomProfilePanel />);
    expect(await screen.findByText("Your device uses Noisy. These are the default settings. They're saved when you apply.")).toBeInTheDocument();
  });

  it('says what to do when no device is connected', async () => {
    render(<CustomProfilePanel />);
    expect(
      await screen.findByText('No device connected. Showing the default settings. Plug in your Primary device to load its settings.')
    ).toBeInTheDocument();
  });

  it('falls back to defaults quietly when the read itself fails', async () => {
    mockRead.mockRejectedValue(new Error('ipc'));
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    expect(field('Buzz length')).toHaveValue(String(CUSTOM_DEFAULTS.on));
  });

  it('shows each range and unit in the hint', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    expect(field('Buzz length')).toHaveAccessibleDescription('50–200 milliseconds');
    expect(field('Timing variation')).toHaveAccessibleDescription('0–50%');
    expect(field('Session length')).toHaveAccessibleDescription('1–240 minutes');
  });

  it('does not complain while typing, only after leaving the field', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    const input = field('Buzz length');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).not.toHaveAttribute('aria-invalid');
    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/Enter a number from 50 to 200\./);
  });

  it('treats 1e3 as out of range and a decimal session length as not whole', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    fireEvent.change(field('Buzz length'), { target: { value: '1e3' } });
    fireEvent.blur(field('Buzz length'));
    expect(field('Buzz length')).toHaveAccessibleDescription(/Enter a number from 50 to 200\./);
    fireEvent.change(field('Session length'), { target: { value: '12.5' } });
    fireEvent.blur(field('Session length'));
    expect(field('Session length')).toHaveAccessibleDescription(/Enter a whole number, like 1\./);
  });

  it('ties the strength conflict to Highest strength', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    fireEvent.change(field('Lowest strength'), { target: { value: '80' } });
    fireEvent.blur(field('Lowest strength'));
    fireEvent.change(field('Highest strength'), { target: { value: '60' } });
    fireEvent.blur(field('Highest strength'));
    expect(field('Highest strength')).toHaveAccessibleDescription(/Lowest strength can't be higher than highest strength\./);
    expect(field('Lowest strength')).not.toHaveAttribute('aria-invalid');
  });

  it('resets to defaults and can undo it', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    fireEvent.change(field('Buzz length'), { target: { value: '120' } });
    fireEvent.blur(field('Buzz length'));
    const changed = screen.getByText('You have changed these values from the defaults.');
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Just above Show Timing Details and Load from Device, after the settings.
    expect(follows(screen.getByRole('switch', { name: 'Same order on both devices' }), changed)).toBe(true);
    expect(follows(changed, screen.getByRole('button', { name: 'Show Timing Details' }))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(field('Buzz length')).toHaveValue(String(CUSTOM_DEFAULTS.on));
    expect(screen.getByText('Settings reset.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(field('Buzz length')).toHaveValue('120');
  });

  it('notes when the pause limits how much timing can vary', async () => {
    useSettingsStore.setState({ settings: { disableLedDuringTherapy: false, debugMode: false, customProfile: { ...CUSTOM_DEFAULTS, off: 30, jitter: 50 } } });
    render(<CustomProfilePanel />);
    expect(await screen.findByText(/With this pause, timing can vary by at most \d+(\.\d)?%\./)).toBeInTheDocument();
  });

  it('keeps timing details one click away', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Show Timing Details' }));
    expect(screen.getByText(/Finger slot \d+ ms · Cycle \d+ ms \([\d.]+ Hz\) on v2/)).toHaveClass('code-s');
  });

  it('labels the mirror switch in plain words', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('switch', { name: 'Same order on both devices' }));
    expect(useSettingsStore.getState().settings.customProfile?.mirror).toBe(true);
  });

  it('can load the settings from the device again', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Load from Device' }));
    await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(2));
  });

  it('follows settings that arrive after it opened (e.g. the saved copy loading)', async () => {
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    act(() => useSettingsStore.getState().setSettings({ customProfile: { ...CUSTOM_DEFAULTS, on: 150 } }));
    expect(field('Buzz length')).toHaveValue('150');
  });

  it('shows a missing saved number as an empty field, not "null"', async () => {
    useSettingsStore.setState({
      settings: { disableLedDuringTherapy: false, debugMode: false, customProfile: { ...CUSTOM_DEFAULTS, on: null as unknown as number } },
    });
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    expect(field('Buzz length')).toHaveValue('');
    expect(field('Buzz length')).toHaveAttribute('aria-invalid', 'true');
  });

  it('highlights an invalid saved value as soon as it opens, so Apply\'s reason matches', async () => {
    useSettingsStore.setState({
      settings: { disableLedDuringTherapy: false, debugMode: false, customProfile: { ...CUSTOM_DEFAULTS, on: 500 } },
    });
    render(<CustomProfilePanel />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    expect(field('Buzz length')).toHaveAccessibleDescription(/Enter a number from 50 to 200\./);
  });
});
