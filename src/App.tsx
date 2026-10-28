import { useCallback, useState } from 'react';
import { ConfigurePage } from './components/configure/ConfigurePage';
import { FirmwarePage } from './components/firmware/FirmwarePage';
import { SettingsPage } from './components/settings/SettingsPage';
import { AppShell } from './components/shell/AppShell';
import { UpdateDialog } from './components/updater/UpdateDialog';
import { ConfirmDialog } from './components/ui/alert-dialog';
import { useAppUpdater } from './hooks/useAppUpdater';
import { useBusyCloseGuard } from './hooks/useBusyCloseGuard';
import { useShortcuts, type Section } from './hooks/useShortcuts';
import { useTheme } from './hooks/useTheme';
import { useIsBusy } from './stores/busy';

const TITLES: Record<Section, string> = {
  firmware: 'Update firmware',
  configure: 'Configure devices',
  settings: 'Settings',
};

function App() {
  const [section, setSection] = useState<Section>('firmware');
  const { busy, kind } = useIsBusy();
  useTheme();
  useAppUpdater();
  const closeGuard = useBusyCloseGuard();

  const rescan = useCallback(() => window.dispatchEvent(new Event('bb:rescan')), []);
  useShortcuts({ onSection: setSection, onRescan: rescan, enabled: !busy });

  const title = kind === 'flash' ? 'Updating firmware' : kind === 'configure' ? 'Setting up devices' : TITLES[section];

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
        title={kind === 'configure' ? 'Setup is still running' : 'The flash is still running'}
        cancelLabel="Keep the Updater open"
        confirmLabel="Close anyway"
        onConfirm={closeGuard.closeAnyway}
      >
        {kind === 'configure'
          ? 'Closing now can leave the device half set up. Wait for it to finish.'
          : 'Closing now can leave the device unable to start. Wait for it to finish.'}
      </ConfirmDialog>
      <UpdateDialog />
    </>
  );
}

export default App;
