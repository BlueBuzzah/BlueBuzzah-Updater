import { useEffect, useRef } from 'react';
import { useUpdaterStore } from '@/stores/updaterStore';
import { updaterService, UpdaterError } from '@/services/UpdaterService';
import { extractUpdaterError } from '@/lib/updater-errors';

/** Check once at launch. A failure is stored for Settings, not shown as a dialog. */
export function useAppUpdater() {
  const { setChecking, setUpdateAvailable, setCheckError } = useUpdaterStore();
  const hasChecked = useRef(false);

  useEffect(() => {
    // Only check once on app startup
    if (hasChecked.current) return;
    hasChecked.current = true;

    const checkForUpdates = async () => {
      setChecking(true);

      try {
        const updateInfo = await updaterService.checkForUpdate();
        setUpdateAvailable(updateInfo);
      } catch (error) {
        console.error('Update check failed:', error);

        // A failed check is news, not an alarm: Settings shows it (plan choice PC-16)
        setCheckError(error instanceof UpdaterError ? error.info : extractUpdaterError(error, 'check'));
      }
    };

    // Small delay to let app initialize
    const timeoutId = setTimeout(checkForUpdates, 1000);

    return () => clearTimeout(timeoutId);
  }, [setChecking, setUpdateAvailable, setCheckError]);
}
