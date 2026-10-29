import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeviceCard } from './device-card';

it('names the role and shows the port in mono', () => {
  render(<DeviceCard name="BlueBuzzah v2" role="PRIMARY" board="BlueBuzzah v2" port="/dev/cu.usbmodem1" />);
  expect(screen.getByText('Primary device')).toBeInTheDocument();
  expect(screen.getByText(/\/dev\/cu\.usbmodem1/)).toHaveClass('code-s');
});

it('is a pressable button when selectable', () => {
  const onSelect = vi.fn();
  const { rerender } = render(<DeviceCard name="BlueBuzzah v3" port="COM3" onSelect={onSelect} />);
  const btn = screen.getByRole('button', { name: /BlueBuzzah v3, port COM3/ });
  expect(btn).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(btn);
  expect(onSelect).toHaveBeenCalledTimes(1);
  rerender(<DeviceCard name="BlueBuzzah v3" port="COM3" onSelect={onSelect} selected />);
  expect(screen.getByRole('button', { name: /selected/ })).toHaveAttribute('aria-pressed', 'true');
});

it('puts the names beside the hand icon, vertically centered', () => {
  render(<DeviceCard name="BlueBuzzah v2" role="PRIMARY" port="COM3" />);
  const row = document.querySelector('.bb-glove__hand')!.parentElement!;
  expect(row).toHaveClass('items-center');
  expect(row).toContainElement(screen.getByText('Primary device'));
  expect(row).toContainElement(screen.getByText('BlueBuzzah v2'));
});
