import { useEffect } from 'react';
import { Info } from 'lucide-react';
import { ICON } from '@/components/ui/icon';
import { Card } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Switch } from '@/components/ui/switch';
import { THERAPY_PROFILES } from '@/lib/therapy-profiles';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTherapyStore } from '@/stores/therapyStore';
import type { TherapyProfile } from '@/types';
import { CustomProfilePanel } from './CustomProfilePanel';

/**
 * Pattern choice plus the device behavior switches. The choice is persisted in
 * settings and mirrored into the configure flow's store.
 */
export function ProfileSelection() {
  const { settings, setSettings, setSelectedProfile, loadFromBackend, isLoaded, loadError } = useSettingsStore();
  const selectProfile = useTherapyStore((s) => s.selectProfile);
  const selected = settings.selectedProfile ?? null;

  useEffect(() => {
    if (!isLoaded) loadFromBackend();
  }, [isLoaded, loadFromBackend]);

  // Keep the configure flow in step with a persisted choice.
  useEffect(() => {
    if (selected) selectProfile(selected);
  }, [selected, selectProfile]);

  const choose = (profile: TherapyProfile) => {
    setSelectedProfile(profile);
    selectProfile(profile);
  };

  return (
    <div className="grid gap-10">
      {loadError && (
        <div className="grid gap-2">
          <p className="body flex items-start gap-2">
            <Info size={ICON.m} className="shrink-0 text-brand" />
            We couldn't load your saved settings, so these are the defaults.
          </p>
          <p className="code-s rounded-xs bg-surface-sunken p-2">{loadError}</p>
        </div>
      )}
      <Card title="Choose a pattern">
        <ChoiceGroup
          label="Choose a pattern"
          value={selected}
          onChange={choose}
          options={THERAPY_PROFILES.map((p) => ({ value: p.id, title: p.name, body: p.description }))}
        />
      </Card>
      {selected === 'CUSTOM' && <CustomProfilePanel />}
      <Card title="Device behavior">
        <div className="grid divide-y divide-line">
          <Switch
            label="Turn off the light during sessions"
            description="The device's light stays off while it buzzes."
            checked={settings.disableLedDuringTherapy}
            onChange={(v) => setSettings({ disableLedDuringTherapy: v })}
          />
          <Switch
            label="Debug output"
            description="Sends extra details over USB for troubleshooting."
            checked={settings.debugMode}
            onChange={(v) => setSettings({ debugMode: v })}
          />
        </div>
      </Card>
    </div>
  );
}
