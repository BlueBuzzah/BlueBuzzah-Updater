import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Banner } from './banner';

it('announced danger is an alert', () => {
  render(<Banner tone="danger" title="Flash failed" announce />);
  expect(screen.getByRole('alert')).toHaveTextContent('Flash failed');
});

it('announced warning is a status', () => {
  render(<Banner tone="warning" title="Keep It plugged in" announce />);
  expect(screen.getByRole('status')).toBeInTheDocument();
});

it('unannounced banner has no role', () => {
  const { container } = render(<Banner title="Tip" />);
  expect(container.firstElementChild).not.toHaveAttribute('role');
});

it('marks a banner without a title as untitled so its icon centers on the first line', () => {
  const { container, rerender } = render(<Banner>Plug in your device.</Banner>);
  expect(container.firstElementChild).toHaveClass('bb-banner--untitled');
  rerender(<Banner title="Tip">Plug in your device.</Banner>);
  expect(container.firstElementChild).not.toHaveClass('bb-banner--untitled');
});
