import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { LogPane } from './log-pane';

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));

const lines = ['INFO  a', 'ERROR  b', 'INFO  c'];

it('is collapsed until opened', () => {
  render(<LogPane lines={lines} />);
  const toggle = screen.getByRole('button', { name: 'Show Log' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Hide Log' })).toHaveAttribute('aria-expanded', 'true');
});

it('shows every numbered line with Copy and Save, and no filter', () => {
  render(<LogPane lines={lines} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show Log' }));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(within(items[1]).getByText('2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy Log' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save Log' })).toBeInTheDocument();
  // Left-aligned
  expect(screen.getByRole('button', { name: 'Copy Log' }).parentElement).not.toHaveClass('justify-end');
});

it('saves the whole log to the chosen file', async () => {
  vi.mocked(save).mockResolvedValue('/tmp/log.txt');
  render(<LogPane lines={lines} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show Log' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save Log' }));
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith('/tmp/log.txt', lines.join('\n')));
  expect(save).toHaveBeenCalledWith({ defaultPath: 'bluebuzzah-updater-log.txt' });
  expect(await screen.findByText('Log saved.')).toBeInTheDocument();
});

it('keeps line numbers in one fixed column so they never wrap', () => {
  render(<LogPane lines={Array.from({ length: 12 }, (_, i) => `INFO  ${i}`)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show Log' }));
  const number = within(screen.getAllByRole('listitem')[9]).getByText('10');
  expect(number).toHaveClass('shrink-0', 'text-right', 'tabular-nums');
  expect(number).toHaveStyle({ minWidth: '2ch' });
});

it('collapsible={false} is always open, with no Show/Hide Log', () => {
  render(<LogPane lines={lines} collapsible={false} />);
  expect(screen.queryByRole('button', { name: 'Show Log' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hide Log' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('list')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto');
  expect(screen.getByRole('button', { name: 'Copy Log' })).toBeInTheDocument();
});

it('shows local HH:MM:SS.mmm timestamps and copies them with each line', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const times = [new Date(2026, 0, 1, 9, 5, 7, 42).getTime(), new Date(2026, 0, 1, 23, 59, 59, 999).getTime()];
  render(<LogPane lines={['[BOOT] a', 'b']} timestamps={times} collapsible={false} />);
  expect(screen.getByText('09:05:07.042')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy Log' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('09:05:07.042 [BOOT] a\n23:59:59.999 b'));
  expect(await screen.findByText('Log copied.')).toBeInTheDocument();
});

it('follow scrolls the list to the newest line when lines change', () => {
  const { rerender } = render(<LogPane lines={lines} collapsible={false} follow />);
  const list = screen.getByRole('list');
  Object.defineProperty(list, 'scrollHeight', { value: 400, configurable: true });
  rerender(<LogPane lines={[...lines, 'INFO  d']} collapsible={false} follow />);
  expect(list.scrollTop).toBe(400);
});

it('does not scroll when follow is off', () => {
  const { rerender } = render(<LogPane lines={lines} collapsible={false} follow={false} />);
  const list = screen.getByRole('list');
  Object.defineProperty(list, 'scrollHeight', { value: 400, configurable: true });
  rerender(<LogPane lines={[...lines, 'INFO  d']} collapsible={false} follow={false} />);
  expect(list.scrollTop).toBe(0);
});

it('numbers lines from firstLineNumber and sizes the column to the largest number', () => {
  render(<LogPane lines={['a', 'b']} collapsible={false} firstLineNumber={4999} />);
  const items = screen.getAllByRole('listitem');
  expect(within(items[0]).getByText('4999')).toHaveStyle({ minWidth: '4ch' });
  expect(within(items[1]).getByText('5000')).toBeInTheDocument();
});
