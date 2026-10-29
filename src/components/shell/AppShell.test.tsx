import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

it('keeps a compact abyss header pinned at the top on every page, busy or not', () => {
  for (const busy of [null, 'flash'] as const) {
    const { unmount } = render(
      <AppShell section="firmware" onSectionChange={vi.fn()} title="Update Firmware" busy={busy}>
        page
      </AppShell>
    );
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('sticky', 'top-0', 'bg-abyss', 'text-on-abyss');
    expect(screen.getByRole('heading', { level: 1, name: 'Update Firmware' })).toHaveClass('title-l');
    unmount();
  }
});
