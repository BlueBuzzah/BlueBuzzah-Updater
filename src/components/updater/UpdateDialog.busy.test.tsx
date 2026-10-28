import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { UpdateDialog } from './UpdateDialog';
import { useUpdaterStore } from '@/stores/updaterStore';
import { useWizardStore } from '@/stores/wizardStore';

beforeEach(() => {
  useUpdaterStore.getState().reset();
  useWizardStore.getState().reset();
});

it('holds the update prompt until a running flash finishes', () => {
  useWizardStore.setState({ currentStep: 2, updateResult: null });
  useUpdaterStore.getState().setUpdateAvailable({ version: '9.9.9', currentVersion: '1.0.0', body: '', date: '' } as never);
  render(<UpdateDialog />);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  act(() => useWizardStore.setState({ updateResult: { success: true, message: '', deviceUpdates: [] } }));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});
