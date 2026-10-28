import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TextField } from './text-field';

it('error marks the field invalid and describes it', () => {
  render(<TextField label="Buzz length" hint="50–200 milliseconds" error="Enter a number from 50 to 200." />);
  const input = screen.getByRole('textbox', { name: 'Buzz length' });
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription(/Enter a number from 50 to 200\./);
});

it('hint alone is the description', () => {
  render(<TextField label="Filter log" hint="Shows lines that contain this text." />);
  const input = screen.getByRole('textbox', { name: 'Filter log' });
  expect(input).not.toHaveAttribute('aria-invalid');
  expect(input).toHaveAccessibleDescription('Shows lines that contain this text.');
});
