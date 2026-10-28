import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TherapyDeviceSelection } from './TherapyDeviceSelection';
import { deviceService } from '@/services/DeviceService';
import { createMockDevice } from '@/test/factories';

vi.mock('@/services/DeviceService', () => ({ deviceService: { detectDevices: vi.fn() } }));

const a = createMockDevice({ path: '/dev/cu.a' });
const boot = createMockDevice({ path: '/dev/cu.boot', inBootloader: true });

beforeEach(() => vi.resetAllMocks());

it('lists app-mode devices as cards you can pick, with a plain count', async () => {
  vi.mocked(deviceService.detectDevices).mockResolvedValue([a, boot]);
  const onToggle = vi.fn();
  render(<TherapyDeviceSelection selectedDevices={[a]} onToggleDevice={onToggle} />);
  const card = await screen.findByRole('button', { name: /port \/dev\/cu\.a, selected/ });
  expect(screen.queryByRole('button', { name: /cu\.boot/ })).toBeNull();
  expect(screen.getByText(/Found 1 device\. 1 selected/)).toBeInTheDocument();
  fireEvent.click(card);
  expect(onToggle).toHaveBeenCalledWith(a);
});

it('rescans on the ⌘/Ctrl+R event', async () => {
  vi.mocked(deviceService.detectDevices).mockResolvedValue([]);
  render(<TherapyDeviceSelection selectedDevices={[]} onToggleDevice={vi.fn()} />);
  expect(await screen.findByText('No devices found')).toBeInTheDocument();
  window.dispatchEvent(new Event('bb:rescan'));
  expect(deviceService.detectDevices).toHaveBeenCalledTimes(2);
});
