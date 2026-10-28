import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ProgressBar } from './progress-bar';

it('shows the percentage in text and to assistive tech', () => {
  render(<ProgressBar label="Overall progress" value={64} detail="Writing firmware — 64%" />);
  const bar = screen.getByRole('progressbar', { name: 'Overall progress' });
  expect(bar).toHaveAttribute('aria-valuenow', '64');
  expect(screen.getByText('64%')).toBeInTheDocument();
  expect(screen.getByText('Writing firmware — 64%')).toBeInTheDocument();
});
