import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmDialog } from './alert-dialog';

it('puts cancel first and the confirm apart, and confirms once', () => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open onOpenChange={() => {}} title="Stop the flash?" cancelLabel="Keep flashing" confirmLabel="Stop flash" onConfirm={onConfirm}>
      The device may not start until you flash it again.
    </ConfirmDialog>
  );
  const dialog = screen.getByRole('alertdialog', { name: 'Stop the flash?' });
  const buttons = Array.from(dialog.querySelectorAll('button'));
  expect(buttons[0]).toHaveTextContent('Keep flashing');
  expect(buttons[buttons.length - 1]).toHaveTextContent('Stop flash');
  expect(buttons[0].parentElement).toHaveClass('justify-between');
  expect(buttons[buttons.length - 1]).toHaveClass('bb-btn--danger');
  fireEvent.click(screen.getByRole('button', { name: 'Stop flash' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
