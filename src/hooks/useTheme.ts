import { useEffect, useState } from 'react';
import { resolveTheme } from '@/lib/theme';
import { useThemeStore } from '@/stores/themeStore';

const LIGHT = '(prefers-color-scheme: light)';
const MORE = '(prefers-contrast: more)';

function readOs() {
  return {
    prefersLight: window.matchMedia(LIGHT).matches,
    prefersMore: window.matchMedia(MORE).matches,
  };
}

/** Apply the resolved theme as data-theme on <html>. Call once, in App. */
export function useTheme(): void {
  const appearance = useThemeStore((s) => s.appearance);
  const highContrast = useThemeStore((s) => s.highContrast);
  const [os, setOs] = useState(readOs);

  useEffect(() => {
    const queries = [window.matchMedia(LIGHT), window.matchMedia(MORE)];
    const update = () => setOs(readOs());
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);

  useEffect(() => {
    const theme = resolveTheme(appearance, highContrast, os);
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [appearance, highContrast, os]);
}
