import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from './useTheme';
import { useThemeStore } from '@/stores/themeStore';

function Probe() {
  useTheme();
  return null;
}

describe('useTheme', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    useThemeStore.setState({ appearance: 'system', highContrast: null });
    delete document.documentElement.dataset.theme;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no OS preference and broken storage renders without data-theme', () => {
    expect(() => render(<Probe />)).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('explicit light override sets data-theme', () => {
    render(<Probe />);
    act(() => useThemeStore.getState().setAppearance('light'));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('returning to system removes data-theme', () => {
    render(<Probe />);
    act(() => useThemeStore.getState().setAppearance('dark'));
    act(() => useThemeStore.getState().setAppearance('system'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
