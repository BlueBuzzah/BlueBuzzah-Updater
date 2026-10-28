import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control';

it('arrow keys move selection and focus with a roving tabindex', () => {
  const onChange = vi.fn();
  render(
    <SegmentedControl
      label="Role"
      options={[{ value: 'PRIMARY', label: 'Primary' }, { value: 'SECONDARY', label: 'Secondary' }]}
      defaultValue="PRIMARY"
      onChange={onChange}
    />
  );
  expect(screen.getByRole('radiogroup', { name: 'Role' })).toBeInTheDocument();
  const primary = screen.getByRole('radio', { name: 'Primary' });
  const secondary = screen.getByRole('radio', { name: 'Secondary' });
  expect(primary).toHaveAttribute('tabindex', '0');
  expect(secondary).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(primary, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenCalledWith('SECONDARY');
  expect(secondary).toHaveAttribute('aria-checked', 'true');
  expect(secondary).toHaveFocus();
  expect(secondary).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(secondary, { key: 'ArrowRight' });
  expect(primary).toHaveAttribute('aria-checked', 'true');
});
