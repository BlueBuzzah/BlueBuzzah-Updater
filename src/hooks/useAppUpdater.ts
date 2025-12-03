import { useEffect, useRef } from 'react';
import { useUpdaterStore } from '@/stores/updaterStore';
import { updaterService } from '@/services/UpdaterService';

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
        // Silently fail - don't show error to user for background check
        setError(null);
        setUpdateAvailable(null);
      }
    };

    // Small delay to let app initialize
    const timeoutId = setTimeout(checkForUpdates, 1000);

    return () => clearTimeout(timeoutId);
  }, [setChecking, setUpdateAvailable, setError]);
}
