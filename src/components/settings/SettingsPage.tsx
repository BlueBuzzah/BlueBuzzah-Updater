import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { extractUpdaterError } from '@/lib/updater-errors';
import type { Appearance } from '@/lib/theme';
import { updaterService, UpdaterError } from '@/services/UpdaterService';
import { useThemeStore } from '@/stores/themeStore';
import { useUpdaterStore } from '@/stores/updaterStore';

const THEMES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Settings: the theme override (README Color) and the app version. */
export function SettingsPage() {
  const { appearance, highContrast, setAppearance, setHighContrast } = useThemeStore();
  const { isChecking, checkError, checked, updateAvailable, setChecking, setUpdateAvailable, setCheckError } = useUpdaterStore();
  const [version, setVersion] = useState('');
  const osMore = window.matchMedia('(prefers-contrast: more)').matches;
  const overridden = appearance !== 'system' || highContrast !== null;

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      setUpdateAvailable(await updaterService.checkForUpdate());
    } catch (err) {
      setCheckError(err instanceof UpdaterError ? err.info : extractUpdaterError(err, 'check'));
    }
  };

  const status = isChecking
    ? 'Checking for updates…'
    : checkError
      ? "Couldn't check for updates. Check your internet connection, then try again."
      : checked && !updateAvailable
        ? 'You have the latest BlueBuzzah Updater.'
        : '';

  return (
    <div className="grid max-w-prose gap-10">
      <Card title="Appearance">
        <div className="grid gap-6">
          <SegmentedControl label="Theme" options={THEMES} value={appearance} onChange={setAppearance} />
          <Switch
            label="High contrast"
            description="Stronger colors and borders. Follows your computer until you change it."
            checked={highContrast ?? osMore}
            onChange={setHighContrast}
          />
          {overridden && (
            <div>
              <Button
                variant="quiet"
                onClick={() => {
                  setAppearance('system');
                  setHighContrast(null);
                }}
              >
                Use my computer's setting
              </Button>
            </div>
          )}
        </div>
      </Card>
      <Card title="About">
        <div className="grid gap-4">
          <p className="body">
            BlueBuzzah Updater <code className="code">{version}</code>
          </p>
          <div>
            <Button variant="secondary" onClick={checkNow} disabled={isChecking}>
              Check for updates
            </Button>
          </div>
          <p className="body-s" aria-live="polite">{status}</p>
        </div>
      </Card>
    </div>
  );
}
