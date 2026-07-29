import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { therapyService } from '@/services/TherapyService';
import { useSettingsStore } from '@/stores/settingsStore';
import { ProfileSelection } from './ProfileSelection';

vi.mock('@/services/TherapyService', () => ({
  therapyService: {
    readCustomProfile: vi.fn(),
    configureProfile: vi.fn(),
  },
}));

const mockRead = vi.mocked(therapyService.readCustomProfile);

describe('ProfileSelection', () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockRead.mockResolvedValue({
      case: 'no_device',
      values: null,
      profileName: null,
      motors: null,
    });
    useSettingsStore.setState({
      settings: { disableLedDuringTherapy: false, debugMode: false },
      isLoaded: true,
    });
  });

  it('offers five profile cards', () => {
    render(<ProfileSelection onSelect={vi.fn()} />);
    for (const name of ['Regular', 'Noisy', 'Hybrid', 'Gentle', 'Custom']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('does not show the parameter panel until Custom is selected', () => {
    render(<ProfileSelection onSelect={vi.fn()} />);
    expect(screen.queryByTestId('derived-timing')).not.toBeInTheDocument();
    expect(therapyService.readCustomProfile).not.toHaveBeenCalled();
  });

  it('expands the parameter panel when Custom is selected', async () => {
    const user = userEvent.setup();
    render(<ProfileSelection onSelect={vi.fn()} />);

    await user.click(screen.getByText('Custom'));

    expect(await screen.findByTestId('derived-timing')).toBeInTheDocument();
    expect(useSettingsStore.getState().settings.selectedProfile).toBe('CUSTOM');
  });

  it('collapses the panel when another profile is selected', async () => {
    const user = userEvent.setup();
    render(<ProfileSelection onSelect={vi.fn()} />);

    await user.click(screen.getByText('Custom'));
    await screen.findByTestId('derived-timing');
    await user.click(screen.getByText('Regular'));

    expect(screen.queryByTestId('derived-timing')).not.toBeInTheDocument();
  });

  it('applies CUSTOM through onSelect', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProfileSelection onSelect={onSelect} />);

    await user.click(screen.getByText('Custom'));
    await user.click(screen.getByRole('button', { name: /apply settings/i }));

    expect(onSelect).toHaveBeenCalledWith('CUSTOM');
  });
});
