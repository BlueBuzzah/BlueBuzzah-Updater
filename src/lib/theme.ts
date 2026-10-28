export type Appearance = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark' | 'light-hc' | 'dark-hc';

/**
 * Pick the data-theme value. null means "follow the OS": tokens.css then
 * applies the OS theme and contrast by itself, defaulting to dark.
 */
export function resolveTheme(
  appearance: Appearance,
  highContrast: boolean | null,
  os: { prefersLight: boolean; prefersMore: boolean }
): Theme | null {
  if (appearance === 'system' && highContrast === null) return null;
  const base = appearance === 'system' ? (os.prefersLight ? 'light' : 'dark') : appearance;
  return (highContrast ?? os.prefersMore) ? `${base}-hc` : base;
}
