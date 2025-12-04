import { useEffect, useRef } from 'react';
import { useUpdaterStore } from '@/stores/updaterStore';
import { updaterService, UpdaterError } from '@/services/UpdaterService';
import { extractUpdaterError } from '@/lib/updater-errors';

export function useAppUpdater() {
  const { setChecking, setUpdateAvailable, setError } = useUpdaterStore();
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

        // Extract and display error details
        if (error instanceof UpdaterError) {
          setError(error.info);
        } else {
          setError(extractUpdaterError(error, 'check'));
        }
        setUpdateAvailable(null);
      }
    };

    // Small delay to let app initialize
    const timeoutId = setTimeout(checkForUpdates, 1000);

    return () => clearTimeout(timeoutId);
  }, [setChecking, setUpdateAvailable, setError]);
}
