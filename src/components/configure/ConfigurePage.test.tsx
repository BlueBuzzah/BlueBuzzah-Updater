import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurePage } from './ConfigurePage';
import { useTherapyStore } from '@/stores/therapyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { CUSTOM_DEFAULTS } from '@/lib/therapy-bounds';
import { createMockDevice } from '@/test/factories';

vi.mock('@/components/wizard/DeviceSelection', () => ({
  DeviceSelection: ({ mode }: { mode: string }) => <div data-testid="device-selection" data-mode={mode} />,
}));
vi.mock('@/components/therapy', () => ({
  ProfileSelection: () => <div data-testid="profile-selection" />,
  TherapyProgress: () => <div data-testid="therapy-progress" />,
  TherapySuccess: () => <div data-testid="therapy-success" />,
}));

const DISCLAIMER =
  'BlueBuzzah devices are not FDA approved medical devices and not intended to diagnose, treat, cure, or prevent any disease. The information provided through BlueBuzzah is for general wellness purposes only and not a substitute for professional medical advice, diagnosis, or treatment.';
const IMPLANT =
  'Important: People with implanted electrodes from deep brain stimulation (DBS), heart pacemakers, or other internal electronic devices should take special precautions around all electronic devices, including BlueBuzzah. Consult your physician before use.';

describe('ConfigurePage choose phase', () => {
  beforeEach(() => {
    useTherapyStore.getState().reset();
    useSettingsStore.setState({ settings: { disableLedDuringTherapy: false, debugMode: false } });
  });

  it('shows both legal notices verbatim', () => {
    render(<ConfigurePage />);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
    const important = screen.getByText('Important:');
    expect(important.tagName).toBe('STRONG');
    expect(important.parentElement!.textContent).toBe(IMPLANT);
  });

  it('puts the legal notices last, just above the action bar', () => {
    render(<ConfigurePage />);
    const notices = screen.getByText(DISCLAIMER);
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(screen.getByTestId('device-selection'), notices)).toBe(true);
    expect(follows(notices, screen.getByTestId('action-bar'))).toBe(true);
  });

  it('explains why Apply is unavailable', () => {
    render(<ConfigurePage />);
    const apply = screen.getByRole('button', { name: 'Apply to Devices' });
    expect(apply).toBeDisabled();
    expect(apply).toHaveClass('bb-btn--lg');
    expect(apply.querySelector('svg')).toHaveClass('lucide-hard-drive-download');
    const bar = screen.getByTestId('action-bar');
    expect(bar).toContainElement(apply);
    expect(bar).toContainElement(screen.getByText('Choose a pattern and at least one device first.'));
  });

  it('blocks Apply while a custom setting is invalid', () => {
    useTherapyStore.setState({ selectedProfile: 'CUSTOM', selectedDevices: [createMockDevice()] });
    useSettingsStore.setState({ settings: { disableLedDuringTherapy: false, debugMode: false, customProfile: { ...CUSTOM_DEFAULTS, on: 10 } } });
    render(<ConfigurePage />);
    expect(screen.getByRole('button', { name: 'Apply to Device' })).toBeDisabled();
    expect(screen.getByText('Fix the highlighted settings first.')).toBeInTheDocument();
  });

  it('applies once for a tremor double click', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    useTherapyStore.setState({ selectedProfile: 'REGULAR', selectedDevices: [createMockDevice({ path: 'a' }), createMockDevice({ path: 'b' })] });
    const setStep = vi.spyOn(useTherapyStore.getState(), 'setStep');
    render(<ConfigurePage />);
    const btn = screen.getByRole('button', { name: 'Apply to Devices' });
    fireEvent.click(btn);
    vi.setSystemTime(1200);
    fireEvent.click(btn);
    expect(setStep).toHaveBeenCalledTimes(1);
    expect(setStep).toHaveBeenCalledWith(2);
    vi.useRealTimers();
  });

  it('uses the Firmware page device card in configure mode', () => {
    render(<ConfigurePage />);
    expect(screen.getByTestId('device-selection')).toHaveAttribute('data-mode', 'configure');
  });
});
