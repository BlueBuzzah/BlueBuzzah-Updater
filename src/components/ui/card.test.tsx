import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Card } from './card';

it('title is the section name', () => {
  render(<Card title="Primary device">x</Card>);
  expect(screen.getByRole('region', { name: 'Primary device' })).toHaveClass('bb-card', 'bb-card--lg');
});

it('titleRef makes the title focusable by script only', () => {
  const ref = createRef<HTMLHeadingElement>();
  render(<Card title="Choose Devices" titleRef={ref}>x</Card>);
  const title = screen.getByRole('heading', { name: 'Choose Devices' });
  expect(ref.current).toBe(title);
  expect(title).toHaveAttribute('tabindex', '-1');
});

it('a title without titleRef is not focusable', () => {
  render(<Card title="Choose Devices">x</Card>);
  expect(screen.getByRole('heading', { name: 'Choose Devices' })).not.toHaveAttribute('tabindex');
});
