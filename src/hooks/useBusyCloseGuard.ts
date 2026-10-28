import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useIsBusy } from '@/stores/busy';

/**
 * Never close during a flash; warn on window close (updater.md). Configure's
 * apply step is covered too, since it reboots devices (plan choice PC-4).
 */
export function useBusyCloseGuard(): { promptOpen: boolean; keepOpen: () => void; closeAnyway: () => Promise<void> } {
  const { busy } = useIsBusy();
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (!busyRef.current) return;
        event.preventDefault();
        setPromptOpen(true);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return {
    promptOpen,
    keepOpen: () => setPromptOpen(false),
    closeAnyway: async () => {
      setPromptOpen(false);
      await getCurrentWindow().destroy();
    },
  };
}
