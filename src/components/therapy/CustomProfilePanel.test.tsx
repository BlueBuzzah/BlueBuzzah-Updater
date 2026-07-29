import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_DEFAULTS } from '@/lib/therapy-bounds';
import { therapyService } from '@/services/TherapyService';
import { useSettingsStore } from '@/stores/settingsStore';
import { CustomProfilePanel } from './CustomProfilePanel';

vi.mock('@/services/TherapyService', () => ({
  therapyService: {
    readCustomProfile: vi.fn(),
    configureProfile: vi.fn(),
  },
}));

const mockRead = vi.mocked(therapyService.readCustomProfile);

describe('CustomProfilePanel', () => {
  beforeEach(() => {
    mockRead.mockReset();
    useSettingsStore.setState({
      settings: { disableLedDuringTherapy: false, debugMode: false },
    });
  });

  it('prefills from the glove and says so when it is on Custom', async () => {
    mockRead.mockResolvedValue({
      case: 'custom',
      values: { ...CUSTOM_DEFAULTS, on: 150 },
      profileName: 'custom_vcr',
      motors: 4,
    });

    render(<CustomProfilePanel />);

    expect(await screen.findByText('Loaded from your primary glove.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(/burst duration/i)).toHaveValue(150);
    });
  });

  it('shows research defaults and names the loaded profile when the glove is elsewhere', async () => {
    mockRead.mockResolvedValue({
      case: 'not_custom',
      values: null,
      profileName: 'regular_vcr',
      motors: 4,
    });

    render(<CustomProfilePanel />);

    expect(
      await screen.findByText(
        /Your glove is set to Regular\. Showing research defaults — these will be saved when you apply\./
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/burst duration/i)).toHaveValue(CUSTOM_DEFAULTS.on);
  });

  it('shows research defaults with the no-glove message when nothing answers', async () => {
    mockRead.mockResolvedValue({
      case: 'no_device',
      values: null,
      profileName: null,
      motors: null,
    });

    render(<CustomProfilePanel />);

    expect(
      await screen.findByText('No glove connected. Showing research defaults.')
    ).toBeInTheDocument();
  });

  it('shows both motor counts in the derived line when no glove was read', async () => {
    mockRead.mockResolvedValue({
      case: 'no_device',
      values: null,
      profileName: null,
      motors: null,
    });

    render(<CustomProfilePanel />);

    const derived = await screen.findByTestId('derived-timing');
    expect(derived).toHaveTextContent('668 ms');
    expect(derived).toHaveTextContent('835 ms');
    expect(derived).toHaveTextContent('4 motors');
  });

  it('shows one motor count when the glove reported its motors', async () => {
    mockRead.mockResolvedValue({
      case: 'custom',
      values: CUSTOM_DEFAULTS,
      profileName: 'custom_vcr',
      motors: 5,
    });

    render(<CustomProfilePanel />);

    const derived = await screen.findByTestId('derived-timing');
    expect(derived).toHaveTextContent('835 ms');
    expect(derived).not.toHaveTextContent('668 ms');
  });

  it('shows the deviation banner and resets on demand', async () => {
    const user = userEvent.setup();
    mockRead.mockResolvedValue({
      case: 'custom',
      values: { ...CUSTOM_DEFAULTS, on: 150 },
      profileName: 'custom_vcr',
      motors: 4,
    });

    render(<CustomProfilePanel />);

    expect(
      await screen.findByText('These settings differ from the researched therapy configuration.')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset to research defaults' }));

    await waitFor(() => {
      expect(screen.getByLabelText(/burst duration/i)).toHaveValue(CUSTOM_DEFAULTS.on);
      expect(
        screen.queryByText('These settings differ from the researched therapy configuration.')
      ).not.toBeInTheDocument();
    });
  });

  it('warns when jitter exceeds what the burst gap can absorb', async () => {
    mockRead.mockResolvedValue({
      case: 'custom',
      values: { ...CUSTOM_DEFAULTS, on: 100, off: 30, jitter: 50 },
      profileName: 'custom_vcr',
      motors: 4,
    });

    render(<CustomProfilePanel />);

    expect(await screen.findByTestId('jitter-advisory')).toHaveTextContent('38');
  });

  it('surfaces a validation error for an out-of-range value', async () => {
    const user = userEvent.setup();
    mockRead.mockResolvedValue({
      case: 'no_device',
      values: null,
      profileName: null,
      motors: null,
    });

    render(<CustomProfilePanel />);

    const input = await screen.findByLabelText(/burst duration/i);
    await user.clear(input);
    await user.type(input, '400');

    expect(await screen.findByText(/must be between 50 and 200 ms/i)).toBeInTheDocument();
  });

  it('re-reads the glove on demand', async () => {
    const user = userEvent.setup();
    mockRead.mockResolvedValue({
      case: 'no_device',
      values: null,
      profileName: null,
      motors: null,
    });

    render(<CustomProfilePanel />);
    await screen.findByText('No glove connected. Showing research defaults.');

    mockRead.mockResolvedValue({
      case: 'custom',
      values: { ...CUSTOM_DEFAULTS, on: 90 },
      profileName: 'custom_vcr',
      motors: 4,
    });

    await user.click(screen.getByRole('button', { name: /re-read from glove/i }));

    expect(await screen.findByText('Loaded from your primary glove.')).toBeInTheDocument();
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it('persists edits to the settings store', async () => {
    const user = userEvent.setup();
    mockRead.mockResolvedValue({
      case: 'no_device',
      values: null,
      profileName: null,
      motors: null,
    });

    render(<CustomProfilePanel />);

    const input = await screen.findByLabelText(/session length/i);
    await user.clear(input);
    await user.type(input, '60');

    await waitFor(() => {
      expect(useSettingsStore.getState().settings.customProfile?.session).toBe(60);
    });
  });
});
