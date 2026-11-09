import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  });

  it('lists Firmware, Configure, Logs, then Settings on Ctrl+1–4', () => {
    render(<Sidebar section="firmware" onSectionChange={vi.fn()} busy={null} />);
    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => r.getAttribute('aria-keyshortcuts'))).toEqual(['Control+1', 'Control+2', 'Control+3', 'Control+4']);
    expect(rows.map((r) => r.textContent)).toEqual(['FirmwareCtrl+1', 'ConfigureCtrl+2', 'LogsCtrl+3', 'SettingsCtrl+4']);
  });

  it('locks every other row while viewing logs, and says why', () => {
    render(<Sidebar section="logs" onSectionChange={vi.fn()} busy="monitor" />);
    expect(screen.getByRole('button', { name: 'Logs' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Logs' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['Firmware', 'Configure', 'Settings']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByText('Available when you stop viewing')).toBeInTheDocument();
  });
});
