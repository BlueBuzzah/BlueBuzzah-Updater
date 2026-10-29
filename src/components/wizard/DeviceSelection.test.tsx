import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useState } from 'react';
import { DeviceSelection } from './DeviceSelection';
import { deviceService } from '@/services/DeviceService';
import { createMockDevice } from '@/test/factories';
import type { Device, DeviceRole } from '@/types';

vi.mock('@/services/DeviceService', () => ({
  deviceService: { detectDevices: vi.fn() },
}));

const v2a = createMockDevice({ path: '/dev/cu.a', serialNumber: 'A1', board: 'nrf52' });
const v2b = createMockDevice({ path: '/dev/cu.b', serialNumber: 'B2', board: 'nrf52' });
const v2c = createMockDevice({ path: '/dev/cu.c', serialNumber: 'C3', board: 'nrf52' });
const v3 = createMockDevice({ path: 'COM7', serialNumber: 'E1', board: 'esp32s3', vid: 0x303a, pid: 0x1001 });

/** Holds selection state like the store does, so role changes re-render. */
function Harness({ initial = [] as Device[], onChange = vi.fn(), mode = 'flash' as 'flash' | 'configure' }) {
  const [selected, setSelected] = useState<Device[]>(initial);
  return (
    <DeviceSelection
      mode={mode}
      selectedDevices={selected}
      onDevicesChange={(d) => {
        onChange(d);
        setSelected(d);
      }}
      onRoleChange={(path: string, role: DeviceRole) =>
        setSelected((s) => s.map((d) => (d.path === path ? { ...d, role } : d)))
      }
    />
  );
}

const MSG_SAME_SETTINGS =
  'Give both devices the same settings so they work properly as a pair. If only one is plugged in, configure the other one the same way next.';

describe('DeviceSelection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('says what it is doing while it looks for devices', async () => {
    let resolve: (d: Device[]) => void = () => {};
    vi.mocked(deviceService.detectDevices).mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<Harness />);
    expect(screen.getByText('Looking for devices…')).toBeInTheDocument();
    await act(async () => resolve([v2a]));
    expect(screen.getByText('Found 1 device.')).toBeInTheDocument();
  });

  it('renders each device as a keyboard-reachable card with its port and serial number in mono', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v3]);
    render(<Harness />);
    const card = await screen.findByRole('button', { name: /BlueBuzzah v2, port \/dev\/cu\.a/ });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Port /dev/cu.a')).toHaveClass('code-s');
    expect(screen.getByText('Serial number A1')).toHaveClass('code-s');
    expect(screen.getByRole('button', { name: /BlueBuzzah v3, port COM7/ })).toBeInTheDocument();
    expect(screen.getByText('Found 2 devices.')).toBeInTheDocument();
  });

  it('shows an empty state with steps when nothing is plugged in', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([]);
    render(<Harness />);
    expect(await screen.findByText('No devices found')).toBeInTheDocument();
    expect(screen.getByText('Plug in a device with a USB data cable. Some cables only charge.')).toBeInTheDocument();
    expect(screen.getByText('Try a different USB port.')).toBeInTheDocument();
  });

  it('selects with the keyboard and asks for a role', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a]);
    render(<Harness />);
    const card = await screen.findByRole('button', { name: /BlueBuzzah v2/ });
    card.focus();
    fireEvent.click(card); // Enter/Space on a <button> fires click
    expect(screen.getByRole('button', { name: /selected/ })).toHaveAttribute('aria-pressed', 'true');
    const roles = screen.getByRole('radiogroup', { name: 'Role' });
    expect(roles).toHaveAccessibleDescription(/Choose a role for this device\./);
    fireEvent.click(screen.getByRole('radio', { name: 'Primary' }));
    expect(screen.getByText('Primary device')).toBeInTheDocument();
    expect(screen.queryByText('Choose a role for this device.')).toBeNull();
  });

  it('selects both devices with roles when exactly 2 of one kind are found', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v2b]);
    render(<Harness />);
    expect(await screen.findByRole('button', { name: /Primary device.*port \/dev\/cu\.a.*selected/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Secondary device.*port \/dev\/cu\.b.*selected/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('We set the roles for you. You can change them.')).toBeInTheDocument();
    expect(screen.getByText(/Found 2 devices\. 2 selected/)).toBeInTheDocument();
  });

  it('keeps an existing selection instead of selecting both', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v2b]);
    render(<Harness initial={[v2a]} />);
    await screen.findByText(/Found 2 devices\. 1 selected/);
    expect(screen.getByRole('button', { name: /port \/dev\/cu\.b/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('auto-assigns roles for two devices and explains duplicates next to the role control', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v2b, v2c]);
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: /port \/dev\/cu\.a/ }));
    fireEvent.click(screen.getByRole('button', { name: /port \/dev\/cu\.b/ }));
    expect(screen.getByText('We set the roles for you. You can change them.')).toBeInTheDocument();
    expect(screen.getByText('Primary device')).toBeInTheDocument();
    expect(screen.getByText('Secondary device')).toBeInTheDocument();
    // Make both Primary
    const groups = screen.getAllByRole('radiogroup', { name: 'Role' });
    fireEvent.click(groups[1].querySelector('[role="radio"]') as HTMLElement);
    const msg = 'Give each device a different role: one Primary, one Secondary.';
    expect(screen.getByText(msg)).toBeInTheDocument();
    groups.forEach((g) => expect(g).toHaveAccessibleDescription(new RegExp(msg)));
  });

  it('allows at most 2 devices', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v2b, v2c]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /port \/dev\/cu\.a/ }));
    fireEvent.click(screen.getByRole('button', { name: /port \/dev\/cu\.b/ }));
    fireEvent.click(screen.getByRole('button', { name: /port \/dev\/cu\.c/ }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByText('You can flash up to 2 devices at once.')).toBeInTheDocument();
  });

  it('refuses to mix v2 and v3 devices', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v3]);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: /port \/dev\/cu\.a/ }));
    fireEvent.click(screen.getByRole('button', { name: /port COM7/ }));
    // Two found, but not one kind: nothing was auto-selected.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByText("You can't flash a v2 and a v3 device together. Flash one kind at a time.")).toBeInTheDocument();
  });

  it('rescans from the button and from the ⌘/Ctrl+R event', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a]);
    render(<Harness />);
    await screen.findByRole('button', { name: /BlueBuzzah v2/ });
    expect(screen.getByRole('button', { name: 'Rescan' }).querySelector('svg')).toHaveClass('lucide-radar');
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));
    await waitFor(() => expect(deviceService.detectDevices).toHaveBeenCalledTimes(2));
    act(() => {
      window.dispatchEvent(new Event('bb:rescan'));
    });
    await waitFor(() => expect(deviceService.detectDevices).toHaveBeenCalledTimes(3));
  });

  it('keeps the newest scan when scans overlap', async () => {
    let first: (d: Device[]) => void = () => {};
    vi.mocked(deviceService.detectDevices)
      .mockImplementationOnce(() => new Promise((r) => (first = r)))
      .mockResolvedValueOnce([v2b]);
    render(<Harness />);
    act(() => {
      window.dispatchEvent(new Event('bb:rescan'));
    });
    await screen.findByRole('button', { name: /port \/dev\/cu\.b/ });
    await act(async () => first([v2a]));
    expect(screen.queryByRole('button', { name: /port \/dev\/cu\.a/ })).toBeNull();
  });

  it('shows a scan failure as a danger banner with the detail underneath', async () => {
    vi.mocked(deviceService.detectDevices).mockRejectedValue(new Error('IOKit busy'));
    render(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't look for devices");
    expect(screen.getByText('IOKit busy')).toHaveClass('code-s');
  });

  it('deselects a device that changed under the same port, and says so', async () => {
    const stale = { ...v2a, role: 'PRIMARY' as DeviceRole };
    vi.mocked(deviceService.detectDevices).mockResolvedValue([{ ...v2a, board: 'esp32s3' }]);
    const onChange = vi.fn();
    render(<Harness initial={[stale]} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
    expect(screen.getByText('A selected device was unplugged or changed, so we deselected it.')).toBeInTheDocument();
  });

  it('keeps a selection that still matches path, board and serial number', async () => {
    vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a]);
    const onChange = vi.fn();
    render(<Harness initial={[{ ...v2a, role: 'PRIMARY' }]} onChange={onChange} />);
    await screen.findByText('Primary device');
    expect(onChange).not.toHaveBeenCalled();
  });

  describe('configure mode (same card, no roles)', () => {
    const boot = createMockDevice({ path: '/dev/cu.boot', serialNumber: 'Z9', inBootloader: true });

    it('uses the same card, copy and rescan, without role controls', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v2b]);
      render(<Harness mode="configure" />);
      expect(screen.getByRole('region', { name: 'Choose Devices' })).toBeInTheDocument();
      expect(screen.getByText('Plug in up to 2 devices with a USB data cable.')).toBeInTheDocument();
      // Exactly 2 found: both are selected without a click.
      expect(await screen.findByText(/Found 2 devices\. 2 selected/)).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup', { name: 'Role' })).toBeNull();
      expect(screen.queryByText('We set the roles for you. You can change them.')).toBeNull();
      expect(screen.queryByText('Primary device')).toBeNull();
      expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
    });

    it('reminds that both devices need the same settings', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a]);
      const { unmount } = render(<Harness mode="configure" />);
      await screen.findByRole('button', { name: /port \/dev\/cu\.a/ });
      expect(screen.getByText(MSG_SAME_SETTINGS)).toBeInTheDocument();
      unmount();
      render(<Harness mode="flash" />);
      await screen.findByRole('button', { name: /port \/dev\/cu\.a/ });
      expect(screen.queryByText(MSG_SAME_SETTINGS)).toBeNull();
    });

    it('hides devices in bootloader mode, since settings can only be written to running firmware', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, boot]);
      render(<Harness mode="configure" />);
      await screen.findByRole('button', { name: /port \/dev\/cu\.a/ });
      expect(screen.queryByRole('button', { name: /cu\.boot/ })).toBeNull();
      expect(screen.getByText('Found 1 device.')).toBeInTheDocument(); // and not auto-selected
    });

    it('selects a v2 and a v3 together when they are the only 2 found', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v3]);
      const onChange = vi.fn();
      render(<Harness mode="configure" onChange={onChange} />);
      await waitFor(() => expect(onChange).toHaveBeenCalledWith([v2a, v3]));
    });

    it('allows a v2 and a v3 together, and says when the limit is reached', async () => {
      vi.mocked(deviceService.detectDevices).mockResolvedValue([v2a, v3, v2c]);
      const onChange = vi.fn();
      render(<Harness mode="configure" onChange={onChange} />);
      fireEvent.click(await screen.findByRole('button', { name: /port \/dev\/cu\.a/ }));
      fireEvent.click(screen.getByRole('button', { name: /port COM7/ }));
      expect(onChange).toHaveBeenLastCalledWith([v2a, v3]);
      fireEvent.click(screen.getByRole('button', { name: /port \/dev\/cu\.c/ }));
      expect(screen.getByText('You can configure up to 2 devices at once.')).toBeInTheDocument();
    });
  });
});
