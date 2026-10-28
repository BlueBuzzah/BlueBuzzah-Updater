/** @type {import('tailwindcss').Config} */

// The theme is the design system's token CSS variables (src/styles/tokens.css),
// replacing Tailwind's defaults so off-system values don't compile.
const v = (name) => `var(--${name})`;
const map = (names, toVar = (n) => n) =>
  Object.fromEntries(names.map((n) => [n, v(toVar(n))]));

const colors = [
  'surface', 'surface-raised', 'surface-sunken', 'surface-overlay',
  'line', 'line-strong', 'ink', 'ink-muted', 'ink-disabled', 'fill-disabled',
  'brand', 'brand-hover', 'brand-pressed', 'brand-soft', 'on-brand',
  'accent', 'glow', 'on-glow', 'abyss', 'on-abyss', 'focus',
  'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft',
  'neutral', 'neutral-soft', 'on-status', 'scrim', 'link',
];

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    colors: { transparent: 'transparent', current: 'currentColor', ...map(colors) },
    spacing: {
      0: '0',
      px: '1px',
      ...map(['1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24'], (n) => `space-${n}`),
      ...map(['target', 'target-lg', 'target-xl', 'target-gap']),
    },
    borderRadius: { none: '0', ...map(['xs', 'sm', 'md', 'lg', 'xl', 'full'], (n) => `radius-${n}`) },
    boxShadow: { none: 'none', 1: v('shadow-1'), 2: v('shadow-2'), 3: v('shadow-3'), focus: v('focus-ring') },
    borderWidth: { 0: '0', DEFAULT: v('border-hairline'), control: v('border-control') },
    fontFamily: map(['display', 'sans', 'mono'], (n) => `font-${n}`),
    // Type comes from the tokens.css classes (.body, .title-m, .caption…).
    fontSize: {},
    transitionDuration: map(['fast', 'base', 'slow'], (n) => `duration-${n}`),
    transitionTimingFunction: map(['standard', 'enter', 'exit'], (n) => `ease-${n}`),
    maxWidth: { none: 'none', full: '100%', prose: v('prose-max'), content: v('content-max') },
    extend: {
      // updater.md: 240px sidebar
      width: { sidebar: '240px' },
    },
  },
  plugins: [],
};
