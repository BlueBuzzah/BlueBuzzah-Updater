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
  const toggle = screen.getByRole('button', { name: 'Show log' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Hide log' })).toHaveAttribute('aria-expanded', 'true');
});

it('filters case-insensitively and keeps original line numbers', () => {
  render(<LogPane lines={lines} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show log' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter log' }), { target: { value: 'error' } });
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(within(items[0]).getByText('2')).toBeInTheDocument();
  expect(within(items[0]).getByText('ERROR  b', { normalizer: (t) => t })).toBeInTheDocument();
});

it('saves the whole log to the chosen file', async () => {
  vi.mocked(save).mockResolvedValue('/tmp/log.txt');
  render(<LogPane lines={lines} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show log' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save log' }));
  await waitFor(() => expect(writeTextFile).toHaveBeenCalledWith('/tmp/log.txt', lines.join('\n')));
  expect(save).toHaveBeenCalledWith({ defaultPath: 'bluebuzzah-updater-log.txt' });
  expect(await screen.findByText('Log saved.')).toBeInTheDocument();
});
