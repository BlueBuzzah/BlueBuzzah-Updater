import { useState, useEffect, useRef } from 'react';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { THERAPY_PROFILES } from '@/lib/therapy-profiles';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTherapyStore } from '@/stores/therapyStore';
import type { TherapyProfile } from '@/types';
import {
	Activity,
	ArrowRight,
	CheckCircle2,
	Feather,
	Gauge,
	Settings,
	Shuffle,
} from 'lucide-react';

interface ProfileSelectionProps {
  /** @deprecated - selectedProfile is now read from settingsStore */
  selectedProfile?: TherapyProfile | null;
  /** Called when "Apply Settings" is clicked - syncs to therapyStore and navigates */
  onSelect: (profile: TherapyProfile) => void;
}

const profileIcons: Record<TherapyProfile, React.ReactNode> = {
  REGULAR: <Gauge className="h-8 w-8 text-primary" />,
  NOISY: <Activity className="h-8 w-8 text-primary" />,
  HYBRID: <Shuffle className="h-8 w-8 text-primary" />,
  GENTLE: <Feather className="h-8 w-8 text-primary" />,
};

export function ProfileSelection({
  onSelect,
}: ProfileSelectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { toast } = useToast();
  const {
    settings,
    setSettings,
    setSelectedProfile,
    loadFromBackend,
    isLoaded,
    loadError,
  } = useSettingsStore();
  const { selectProfile } = useTherapyStore();

  // Read persisted profile from settings
  const selectedProfile = settings.selectedProfile ?? null;

  // Load settings from backend on mount
  useEffect(() => {
    if (!isLoaded) {
      loadFromBackend();
    }
  }, [isLoaded, loadFromBackend]);

  // Show toast when settings fail to load from backend (fire once per error)
  const shownErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (loadError && loadError !== shownErrorRef.current) {
      shownErrorRef.current = loadError;
      toast({
        variant: 'destructive',
        title: 'Settings Load Error',
        description: `Could not load saved settings: ${loadError}. Using defaults.`,
      });
    }
  }, [loadError, toast]);

  // Handle profile card click - update settingsStore (persisted)
  const handleProfileClick = (profile: TherapyProfile) => {
    setSelectedProfile(profile);
  };

  // Handle Apply Settings - sync to therapyStore and navigate
  const handleApplySettings = () => {
    if (selectedProfile) {
      // Sync to therapy workflow store
      selectProfile(selectedProfile);
      // Navigate to device selection
      onSelect(selectedProfile);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-2">Select Therapy Profile</h2>
          <p className="text-muted-foreground">
            Choose a vibration pattern for your devices
          </p>
        </div>

        {/* Advanced Toggle - right aligned */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <label
                className={`
                  group flex items-center gap-2.5 px-3 py-2 rounded-lg
                  border transition-all duration-200 cursor-pointer select-none
                  ${
                    showAdvanced
                      ? 'bg-emerald-500/10 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                      : 'bg-zinc-900/50 border-zinc-700/50 hover:border-zinc-600'
                  }
                `}
              >
                <Settings
                  className={`h-4 w-4 transition-colors duration-200 ${
                    showAdvanced
                      ? 'text-emerald-400'
                      : 'text-zinc-500 group-hover:text-zinc-400'
                  }`}
                />
                <span
                  className={`text-sm font-medium transition-colors duration-200 ${
                    showAdvanced
                      ? 'text-emerald-400'
                      : 'text-zinc-400 group-hover:text-zinc-300'
                  }`}
                >
                  Advanced
                </span>
                <Switch
                  checked={showAdvanced}
                  onCheckedChange={setShowAdvanced}
                  className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-700"
                />
              </label>
            </TooltipTrigger>
            <TooltipContent
              className="max-w-xs bg-zinc-900 border border-emerald-500/30 shadow-lg shadow-emerald-500/5"
              sideOffset={8}
            >
              <p className="font-semibold text-emerald-400 text-sm">
                Advanced Settings
              </p>
              <p className="text-zinc-300 text-xs mt-1.5 leading-relaxed">
                Configure additional device behavior options for therapy sessions.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Advanced Settings Card - shown when toggle is ON */}
      {showAdvanced && (
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5 text-emerald-400" />
              <span>Advanced Settings</span>
            </CardTitle>
            <CardDescription>
              Configure additional advanced device behaviors
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Switch
                id="disable-led"
                checked={settings.disableLedDuringTherapy}
                onCheckedChange={(checked) =>
                  setSettings({ disableLedDuringTherapy: checked })
                }
                className="data-[state=checked]:bg-emerald-500"
              />
              <div className="space-y-0.5">
                <Label htmlFor="disable-led" className="text-sm font-medium">
                  Disable LED During Therapy
                </Label>
                <p className="text-xs text-muted-foreground">
                  Turn off device LED indicators while therapy is active
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Switch
                id="debug-mode"
                checked={settings.debugMode}
                onCheckedChange={(checked) =>
                  setSettings({ debugMode: checked })
                }
                className="data-[state=checked]:bg-emerald-500"
              />
              <div className="space-y-0.5">
                <Label htmlFor="debug-mode" className="text-sm font-medium">
                  Debug Mode
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable debug output from device during therapy sessions
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {THERAPY_PROFILES.map((profile) => {
          const isSelected = selectedProfile === profile.id;

          return (
            <Card
              key={profile.id}
              className={`transition-all cursor-pointer hover:shadow-lg hover:border-primary/50 group ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => handleProfileClick(profile.id)}
            >
              <CardHeader className="text-center pb-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex-1" />
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    {profileIcons[profile.id]}
                  </div>
                  <div className="flex-1 flex justify-end">
                    {isSelected && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </div>
                <CardTitle className="text-lg">{profile.name}</CardTitle>
              </CardHeader>
              <CardContent className="text-center">
                <CardDescription className="text-sm">
                  {profile.description}
                </CardDescription>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-2">Profile Details:</p>
            <ul className="space-y-2">
              <li>
                <span className="font-medium">Regular:</span> Default vCR pattern
                with consistent, non-mirrored stimulation
              </li>
              <li>
                <span className="font-medium">Noisy:</span> Mirrored pattern with
                23.5% jitter for varied, unpredictable stimulation
              </li>
              <li>
                <span className="font-medium">Hybrid:</span> Non-mirrored pattern
                with 23.5% jitter combining consistency with variation
              </li>
              <li>
                <span className="font-medium">Gentle:</span> Lower amplitude with
                sequential pattern for sensitive users
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Apply Settings Button */}
      <div className="flex justify-end pt-2">
        <Button
          size="lg"
          onClick={handleApplySettings}
          disabled={!selectedProfile}
          className="min-w-[200px]"
        >
          Apply Settings
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
