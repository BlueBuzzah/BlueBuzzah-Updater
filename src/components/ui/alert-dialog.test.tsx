import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmDialog } from './alert-dialog';

it('puts cancel first and the confirm apart, and confirms once', () => {
  const onConfirm = vi.fn();
  render(
    <ConfirmDialog open onOpenChange={() => {}} title="Stop the Flash?" cancelLabel="Keep Flashing" confirmLabel="Stop Flash" onConfirm={onConfirm}>
      The device may not start until you flash it again.
    </ConfirmDialog>
  );
  const dialog = screen.getByRole('alertdialog', { name: 'Stop the Flash?' });
  const buttons = Array.from(dialog.querySelectorAll('button'));
  expect(buttons[0]).toHaveTextContent('Keep Flashing');
  expect(buttons[buttons.length - 1]).toHaveTextContent('Stop Flash');
  expect(buttons[0].parentElement).toHaveClass('justify-between');
  expect(buttons[buttons.length - 1]).toHaveClass('bb-btn--danger');
  fireEvent.click(screen.getByRole('button', { name: 'Stop Flash' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
