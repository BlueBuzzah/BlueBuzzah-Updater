import { useCallback, useState } from 'react';
import { ConfigurePage } from './components/configure/ConfigurePage';
import { FirmwarePage } from './components/firmware/FirmwarePage';
import { SettingsPage } from './components/settings/SettingsPage';
import { AppShell } from './components/shell/AppShell';
import { Toaster } from './components/ui/toaster';
import { UpdateDialog } from './components/updater/UpdateDialog';
import { useAppUpdater } from './hooks/useAppUpdater';
import { useShortcuts, type Section } from './hooks/useShortcuts';
import { useTheme } from './hooks/useTheme';
import { useIsBusy } from './stores/busy';

const TITLES: Record<Section, string> = {
  firmware: 'Flash firmware',
  configure: 'Configure devices',
  settings: 'Settings',
};

function App() {
  const [section, setSection] = useState<Section>('firmware');
  const { busy, kind } = useIsBusy();
  useTheme();
  useAppUpdater();

  const rescan = useCallback(() => window.dispatchEvent(new Event('bb:rescan')), []);
  useShortcuts({ onSection: setSection, onRescan: rescan, enabled: !busy });

  const title = kind === 'flash' ? 'Flashing firmware' : kind === 'configure' ? 'Setting up devices' : TITLES[section];

  return (
    <>
      <AppShell section={section} onSectionChange={setSection} title={title} busy={kind}>
        {section === 'firmware' && <FirmwarePage />}
        {section === 'configure' && <ConfigurePage />}
        {section === 'settings' && <SettingsPage />}
      </AppShell>
      <Toaster />
      <UpdateDialog />
    </>
  );
}

export default App;
