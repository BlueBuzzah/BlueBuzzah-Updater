import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopyToClipboard } from './useCopyToClipboard';

// Mock useToast
const mockToast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies text and shows success toast', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('test text', 'Test logs');
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test text');
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Logs copied',
      description: 'Test logs have been copied to clipboard',
    });
  });

  it('shows error toast on clipboard failure', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('test text', 'Test logs');
    });

    expect(mockToast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Copy Failed',
      description: 'Could not copy to clipboard.',
    });
  });

  it('logs warning on clipboard failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('denied');
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(error) },
    });

    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copyToClipboard('test text', 'Test logs');
    });

    expect(warnSpy).toHaveBeenCalledWith('Clipboard write failed:', error);
    warnSpy.mockRestore();
  });
});
