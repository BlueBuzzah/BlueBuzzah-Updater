import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Card } from './card';

it('title is the section name', () => {
  render(<Card title="Primary device">x</Card>);
  expect(screen.getByRole('region', { name: 'Primary device' })).toHaveClass('bb-card', 'bb-card--lg');
});
