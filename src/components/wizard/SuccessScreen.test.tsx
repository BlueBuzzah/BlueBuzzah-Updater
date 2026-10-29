import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuccessScreen } from './SuccessScreen';
import { useWizardStore } from '@/stores/wizardStore';
import { createMockDevice, createMockRelease } from '@/test/factories';

const release = createMockRelease({ version: '2.0.4' });
const primary = createMockDevice({ path: '/dev/cu.a', role: 'PRIMARY' });
const secondary = createMockDevice({ path: '/dev/cu.b', role: 'SECONDARY' });

describe('SuccessScreen', () => {
  beforeEach(() => useWizardStore.getState().reset());

  it('confirms the new version in code inside a success banner', () => {
    useWizardStore.setState({ updateResult: { success: true, message: '', deviceUpdates: [{ device: primary, success: true }] } });
    render(<SuccessScreen release={release} devices={[primary]} onClose={vi.fn()} />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Firmware 2.0.4 is on your device');
    expect(screen.getByText('2.0.4')).toHaveClass('code');
    expect(document.body).not.toHaveTextContent('Latest');
    expect(document.body).not.toHaveTextContent('15sec');
  });

  it('tells two devices how to pair without a time limit', () => {
    useWizardStore.setState({
      updateResult: { success: true, message: '', deviceUpdates: [{ device: primary, success: true }, { device: secondary, success: true }] },
    });
    render(<SuccessScreen release={release} devices={[primary, secondary]} onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Firmware 2.0.4 is on both devices');
    expect(screen.getByText(/Turn them on and they find each other on their own\./)).toBeInTheDocument();
    expect(screen.getAllByText('Done', { selector: '.bb-badge span' })).toHaveLength(2);
  });

  it('offers only Done, on the Show Log row', () => {
    const onClose = vi.fn();
    useWizardStore.setState({ updateResult: { success: true, message: '', deviceUpdates: [{ device: primary, success: true }] } });
    render(<SuccessScreen release={release} devices={[primary]} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: 'Flash Another Device' })).not.toBeInTheDocument();
    const done = screen.getByRole('button', { name: /^Done$/ });
    expect(done.parentElement).toBe(screen.getByRole('button', { name: 'Show Log' }).parentElement);
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
