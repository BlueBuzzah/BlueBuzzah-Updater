import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('follows the OS (no data-theme) when nothing is overridden', () => {
    expect(resolveTheme('system', null, { prefersLight: true, prefersMore: true })).toBeNull();
  });
  it('explicit light picks up OS high contrast', () => {
    expect(resolveTheme('light', null, { prefersLight: false, prefersMore: true })).toBe('light-hc');
  });
  it('explicit high contrast off wins over the OS', () => {
    expect(resolveTheme('dark', false, { prefersLight: true, prefersMore: true })).toBe('dark');
  });
  it('defaults to dark when the OS reports no preference', () => {
    expect(resolveTheme('system', true, { prefersLight: false, prefersMore: false })).toBe('dark-hc');
  });
  it('system appearance follows an OS light preference', () => {
    expect(resolveTheme('system', false, { prefersLight: true, prefersMore: true })).toBe('light');
  });
});
