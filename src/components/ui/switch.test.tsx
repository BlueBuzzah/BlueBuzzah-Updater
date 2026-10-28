import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Switch } from './switch';

it('toggles and reports the new value', () => {
  const onChange = vi.fn();
  render(<Switch label="High contrast" description="Stronger colors and borders." onChange={onChange} />);
  const sw = screen.getByRole('switch', { name: 'High contrast' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  expect(sw).toHaveAccessibleDescription('Stronger colors and borders.');
  fireEvent.click(sw);
  expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(onChange).toHaveBeenCalledWith(true);
});
