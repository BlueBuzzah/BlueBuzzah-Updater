import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StatusBadge } from './status-badge';

it('success shows an icon and the word', () => {
  const { container } = render(<StatusBadge tone="success">Done</StatusBadge>);
  expect(container.querySelector('.bb-badge--success svg')).not.toBeNull();
  expect(container).toHaveTextContent('Done');
});

it('neutral shows a dot', () => {
  const { container } = render(<StatusBadge>Waiting</StatusBadge>);
  expect(container.querySelector('.bb-badge__dot')).not.toBeNull();
});
