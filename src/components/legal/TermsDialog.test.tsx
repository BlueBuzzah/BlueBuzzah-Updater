import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { exit } from '@tauri-apps/plugin-process';
import { TermsDialog } from './TermsDialog';
import { IMPLANT_NOTICE, MEDICAL_DISCLAIMER, PRIVACY_URL, TERMS_EFFECTIVE_DATE, TERMS_URL } from '@/lib/legal';
import { useSettingsStore } from '@/stores/settingsStore';

vi.mock('@tauri-apps/plugin-process', () => ({ exit: vi.fn() }));

describe('TermsDialog', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { disableLedDuringTherapy: false, debugMode: false, selectedProfile: null, termsAcceptedDate: null },
      isLoaded: true,
      isSyncing: false,
    });
  });

  it('shows both notices verbatim with the links', () => {
    render(<TermsDialog open />);
    expect(screen.getByRole('alertdialog', { name: 'Before You Start' })).toBeInTheDocument();
    expect(screen.getByText(MEDICAL_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText('Important:').parentElement).toHaveTextContent(IMPLANT_NOTICE);
    fireEvent.click(screen.getByRole('button', { name: 'Terms and Safety' }));
    fireEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));
    expect(open).toHaveBeenNthCalledWith(1, TERMS_URL);
    expect(open).toHaveBeenNthCalledWith(2, PRIVACY_URL);
  });

  it('I Agree stores the effective date and saves it', () => {
    render(<TermsDialog open />);
    fireEvent.click(screen.getByRole('button', { name: 'I Agree' }));
    expect(useSettingsStore.getState().settings.termsAcceptedDate).toBe(TERMS_EFFECTIVE_DATE);
    expect(invoke).toHaveBeenCalledWith('save_advanced_settings', {
      settings: expect.objectContaining({ termsAcceptedDate: TERMS_EFFECTIVE_DATE }),
    });
  });

  it('Quit exits; Escape does nothing', () => {
    render(<TermsDialog open />);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('renders nothing once accepted', () => {
    render(<TermsDialog open={false} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
