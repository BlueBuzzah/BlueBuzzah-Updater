import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { firstVisibleRow, LogPane } from './log-pane';

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
  expect(screen.getByRole('list')).toHaveClass('bb-log', 'min-h-0', 'flex-1', 'overflow-auto');
  expect(screen.getByRole('button', { name: 'Copy Log' })).toBeInTheDocument();
});

it('collapsible={false} drops the Copy and Save icons so both fit one row in a narrow pane', () => {
  const { rerender } = render(<LogPane lines={lines} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show Log' }));
  expect(screen.getByRole('button', { name: 'Copy Log' }).querySelector('svg')).not.toBeNull();
  rerender(<LogPane lines={lines} collapsible={false} />);
  expect(screen.getByRole('button', { name: 'Copy Log' }).querySelector('svg')).toBeNull();
  expect(screen.getByRole('button', { name: 'Save Log' }).querySelector('svg')).toBeNull();
});

it('collapsible={false} keeps each line on one row with its number and time pinned at the left', () => {
  render(<LogPane lines={['a long line']} timestamps={[new Date(2026, 0, 1, 9, 5, 7, 42).getTime()]} collapsible={false} />);
  const row = screen.getByRole('listitem');
  expect(within(row).getByText('a long line')).toHaveClass('whitespace-pre');
  // The time column is the one the .bb-log container query hides in a narrow pane.
  const time = within(row).getByText('09:05:07.042');
  expect(time).toHaveClass('bb-log__time');
  expect(time.parentElement).toHaveClass('sticky', 'left-0', 'bg-surface-sunken');
});

it('a collapsible log still wraps long lines', () => {
  render(<LogPane lines={['a long line']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show Log' }));
  expect(within(screen.getByRole('listitem')).getByText('a long line')).toHaveClass('whitespace-pre-wrap');
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

describe('scrolling sets follow', () => {
  const setup = (follow: boolean) => {
    const onFollowChange = vi.fn();
    render(<LogPane lines={lines} collapsible={false} follow={follow} onFollowChange={onFollowChange} />);
    const list = screen.getByRole('list');
    Object.defineProperty(list, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    const scrollTo = (top: number) => {
      list.scrollTop = top;
      fireEvent.scroll(list);
    };
    return { onFollowChange, scrollTo };
  };

  it('scrolling up while following stops auto-scroll', () => {
    const { onFollowChange, scrollTo } = setup(true);
    scrollTo(300);
    expect(onFollowChange).not.toHaveBeenCalled(); // at the bottom: the follow scroll itself
    scrollTo(250);
    expect(onFollowChange).toHaveBeenCalledWith(false);
  });

  it('scrolling back to the bottom while paused starts it again', () => {
    const { onFollowChange, scrollTo } = setup(false);
    scrollTo(100);
    expect(onFollowChange).not.toHaveBeenCalled();
    scrollTo(299);
    expect(onFollowChange).toHaveBeenCalledWith(true);
  });
});

it('numbers lines from firstLineNumber and sizes the column to the largest number', () => {
  render(<LogPane lines={['a', 'b']} collapsible={false} firstLineNumber={4999} />);
  const items = screen.getAllByRole('listitem');
  expect(within(items[0]).getByText('4999')).toHaveStyle({ minWidth: '4ch' });
  expect(within(items[1]).getByText('5000')).toBeInTheDocument();
});

it('the scrolling list is keyboard-focusable and named', () => {
  render(<LogPane lines={lines} collapsible={false} label="BlueBuzzah v2 /dev/cu.a log" />);
  const list = screen.getByRole('list', { name: 'BlueBuzzah v2 /dev/cu.a log' });
  expect(list).toHaveAttribute('tabindex', '0');
});

it('firstVisibleRow finds the row at the top of the view', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ offsetTop: i * 20, offsetHeight: 20 }));
  expect(firstVisibleRow(rows, 0)).toBe(0);
  expect(firstVisibleRow(rows, 19)).toBe(0);
  expect(firstVisibleRow(rows, 20)).toBe(1);
  expect(firstVisibleRow(rows, 105)).toBe(5);
  expect(firstVisibleRow(rows, 1000)).toBe(9);
});

describe('paused at the line cap', () => {
  // jsdom has no layout: each row sits 20px below the one before it.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement ? Array.prototype.indexOf.call(this.parentElement.children, this) * 20 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
  });
  afterEach(() => vi.restoreAllMocks());

  const numbered = (from: number, count: number) => Array.from({ length: count }, (_, i) => `line ${from + i}`);

  it('keeps the line being read in place when old lines drop off the top', () => {
    const { rerender } = render(<LogPane lines={numbered(1, 10)} firstLineNumber={1} collapsible={false} follow={false} />);
    const list = screen.getByRole('list');
    list.scrollTop = 100; // line 6 at the top
    fireEvent.scroll(list);
    // 3 lines dropped, 3 added: line 6 moves from row 5 to row 2.
    rerender(<LogPane lines={numbered(4, 10)} firstLineNumber={4} collapsible={false} follow={false} />);
    expect(list.scrollTop).toBe(40);
  });

  it('holds the line at the top after Pause with no scroll in between', () => {
    const { rerender } = render(<LogPane lines={numbered(1, 9)} firstLineNumber={1} collapsible={false} follow />);
    const list = screen.getByRole('list');
    Object.defineProperty(list, 'scrollHeight', { value: 100, configurable: true });
    rerender(<LogPane lines={numbered(1, 10)} firstLineNumber={1} collapsible={false} follow />);
    expect(list.scrollTop).toBe(100); // following: line 6 at the top
    rerender(<LogPane lines={numbered(1, 10)} firstLineNumber={1} collapsible={false} follow={false} />);
    rerender(<LogPane lines={numbered(4, 10)} firstLineNumber={4} collapsible={false} follow={false} />);
    expect(list.scrollTop).toBe(40);
  });
});
