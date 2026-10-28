import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('xl ignores a second click within 400ms', () => {
    const onClick = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    render(<Button size="xl" onClick={onClick}>Flash firmware</Button>);
    const btn = screen.getByRole('button', { name: 'Flash firmware' });
    fireEvent.click(btn);
    vi.setSystemTime(1300);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('second click after 400ms fires', () => {
    const onClick = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    render(<Button size="xl" onClick={onClick}>Flash firmware</Button>);
    const btn = screen.getByRole('button');
    fireEvent.click(btn);
    vi.setSystemTime(1401);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('md does not guard unless asked', () => {
    const onClick = vi.fn();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    render(<Button onClick={onClick}>Rescan</Button>);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('variant and size classes', () => {
    render(<Button variant="secondary" size="lg">Copy log</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('bb-btn', 'bb-btn--secondary', 'bb-btn--lg');
    expect(btn).toHaveAttribute('type', 'button');
  });
});
