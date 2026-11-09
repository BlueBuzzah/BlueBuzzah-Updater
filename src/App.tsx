import { useCallback, useEffect, useState } from 'react';
import { ConfigurePage } from './components/configure/ConfigurePage';
import { FirmwarePage } from './components/firmware/FirmwarePage';
import { TermsDialog } from './components/legal/TermsDialog';
import { SettingsPage } from './components/settings/SettingsPage';
import { AppShell } from './components/shell/AppShell';
import { UpdateDialog } from './components/updater/UpdateDialog';
import { ConfirmDialog } from './components/ui/alert-dialog';
import { useAppUpdater } from './hooks/useAppUpdater';
import { useBusyCloseGuard } from './hooks/useBusyCloseGuard';
import { useShortcuts, type Section } from './hooks/useShortcuts';
import { useTheme } from './hooks/useTheme';
import { needsTermsAcceptance } from './lib/legal';
import { useIsBusy } from './stores/busy';
import { useSettingsStore } from './stores/settingsStore';

const TITLES: Record<Section, string> = {
  firmware: 'Update Firmware',
  configure: 'Configure Devices',
  logs: 'Device Logs',
  settings: 'Settings',
};

function App() {
  const [section, setSection] = useState<Section>('firmware');
  const { busy, kind } = useIsBusy();
  useTheme();
  useAppUpdater();
  const closeGuard = useBusyCloseGuard();

  // Settings gate the shell: nothing is usable until the current Terms are accepted
  const settingsLoaded = useSettingsStore((s) => s.isLoaded);
  const loadSettings = useSettingsStore((s) => s.loadFromBackend);
  const termsAcceptedDate = useSettingsStore((s) => s.settings.termsAcceptedDate);
  useEffect(() => {
    if (!settingsLoaded) loadSettings();
  }, [settingsLoaded, loadSettings]);
  const termsOpen = settingsLoaded && needsTermsAcceptance(termsAcceptedDate);

  const rescan = useCallback(() => window.dispatchEvent(new Event('bb:rescan')), []);
  useShortcuts({ onSection: setSection, onRescan: rescan, enabled: !busy && !termsOpen });

  const title = kind === 'flash' ? 'Updating Firmware' : kind === 'configure' ? 'Setting Up Devices' : TITLES[section];

  return (
    <>
      <AppShell section={section} onSectionChange={setSection} title={title} busy={kind}>
        {section === 'firmware' && <FirmwarePage />}
        {section === 'configure' && <ConfigurePage />}
        {section === 'settings' && <SettingsPage />}
      </AppShell>
      <ConfirmDialog
        open={closeGuard.promptOpen}
        onOpenChange={(open) => !open && closeGuard.keepOpen()}
        title={kind === 'configure' ? 'Setup Is Still Running' : 'The Flash Is Still Running'}
        cancelLabel="Keep the Updater Open"
        confirmLabel="Close Anyway"
        onConfirm={closeGuard.closeAnyway}
      >
        {kind === 'configure'
          ? 'Closing now can leave the device half set up. Wait for it to finish.'
          : 'Closing now can leave the device unable to start. Wait for it to finish.'}
      </ConfirmDialog>
      {!termsOpen && <UpdateDialog />}
      <TermsDialog open={termsOpen} />
    </>
  );
}

export default App;
