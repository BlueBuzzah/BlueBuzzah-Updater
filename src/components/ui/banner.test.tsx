import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Banner } from './banner';

it('announced danger is an alert', () => {
  render(<Banner tone="danger" title="Flash failed" announce />);
  expect(screen.getByRole('alert')).toHaveTextContent('Flash failed');
});

it('announced warning is a status', () => {
  render(<Banner tone="warning" title="Keep it plugged in" announce />);
  expect(screen.getByRole('status')).toBeInTheDocument();
});

it('unannounced banner has no role', () => {
  const { container } = render(<Banner title="Tip" />);
  expect(container.firstElementChild).not.toHaveAttribute('role');
});
