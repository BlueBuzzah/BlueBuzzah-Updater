import type * as React from 'react';

/** Index an arrow key moves to in a radio group (wraps); null for other keys. */
export function arrowTarget(e: React.KeyboardEvent, i: number, count: number): number | null {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step) return null;
  e.preventDefault();
  return (i + step + count) % count;
}
