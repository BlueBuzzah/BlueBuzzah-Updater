import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface ActionBarProps {
  /** Why the main action is unavailable, shown beside the buttons */
  hint?: string | null;
  hintId?: string;
  /** Span the whole column instead of the content width, for pages whose content does (Logs) */
  wide?: boolean;
  children: ReactNode;
}

/**
 * A page's main actions, in a band colored like the sidebar. AppShell's main is a flex
 * column, so mt-auto keeps the band at the bottom of a short page. The negative margins
 * cancel main's padding (p-4 md:p-10) so the band spans the column.
 */
export function ActionBar({ hint, hintId, wide, children }: ActionBarProps) {
  return (
    <div data-testid="action-bar" className="-mx-4 -mb-4 mt-auto border-t border-line bg-surface-raised px-4 py-4 md:-mx-10 md:-mb-10 md:px-10">
      <div className={cn('flex flex-wrap items-center justify-end gap-x-6 gap-y-3', !wide && 'max-w-content')}>
        {hint && (
          <p id={hintId} className="body-s min-w-0 flex-1 text-right text-ink-muted">
            {hint}
          </p>
        )}
        <div className="flex flex-wrap gap-target-gap">{children}</div>
      </div>
    </div>
  );
}
