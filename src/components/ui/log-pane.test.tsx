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
