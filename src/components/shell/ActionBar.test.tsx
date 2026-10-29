import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ActionBar } from './ActionBar';

it('puts the hint beside the buttons in a sidebar-colored band', () => {
  render(
    <ActionBar hint="Choose a device first." hintId="why">
      <button>Go</button>
    </ActionBar>
  );
  const bar = screen.getByTestId('action-bar');
  expect(bar).toHaveClass('bg-surface-raised', 'mt-auto');
  expect(bar.firstElementChild).toHaveClass('items-center');
  expect(screen.getByText('Choose a device first.')).toHaveAttribute('id', 'why');
  expect(bar).toContainElement(screen.getByRole('button', { name: 'Go' }));
});

it('shows no hint when there is none', () => {
  render(
    <ActionBar hint={null}>
      <button>Go</button>
    </ActionBar>
  );
  expect(screen.getByTestId('action-bar').querySelector('p')).toBeNull();
});
