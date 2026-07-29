import { useEffect, useRef, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  CUSTOM_BOUNDS,
  CUSTOM_DEFAULTS,
  crTiming,
  effectiveJitterCapPct,
  isDeviatingFromDefaults,
  validateCustomParams,
  type CustomNumericField,
  type CustomProfileParams,
} from '@/lib/therapy-bounds';
import { therapyService } from '@/services/TherapyService';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CustomProfileRead } from '@/types';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';

/** Firmware profile name -> display name, for the "not_custom" prefill message. */
const PROFILE_DISPLAY_NAMES: Record<string, string> = {
  regular_vcr: 'Regular',
  noisy_vcr: 'Noisy',
  hybrid_vcr: 'Hybrid',
  gentle: 'Gentle',
};

const NUMERIC_FIELDS: CustomNumericField[] = [
  'on',
  'off',
  'jitter',
  'ampMin',
  'ampMax',
  'session',
];

export function CustomProfilePanel(): JSX.Element {
  const { settings, setSettings } = useSettingsStore();
  const [read, setRead] = useState<CustomProfileRead | null>(null);
  const [isReading, setIsReading] = useState(false);
  const hasReadRef = useRef(false);

  const values: CustomProfileParams = settings.customProfile ?? CUSTOM_DEFAULTS;

  const doRead = async () => {
    setIsReading(true);
    try {
      const result = await therapyService.readCustomProfile();
      setRead(result);
      if (result.case === 'custom' && result.values) {
        // The device is the source of truth for what is actually on the
        // hardware, so a successful read overrides the persisted values.
        setSettings({ customProfile: result.values });
      }
    } finally {
      setIsReading(false);
    }
  };

  useEffect(() => {
    // Prevent double-execution in React StrictMode (development only)
    if (hasReadRef.current) return;
    hasReadRef.current = true;
    doRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFieldChange = (field: CustomNumericField, raw: string) => {
    const parsed = Number(raw);
    setSettings({ customProfile: { ...values, [field]: parsed } });
  };

  const handleMirrorChange = (checked: boolean) => {
    setSettings({ customProfile: { ...values, mirror: checked } });
  };

  const handleReset = () => {
    setSettings({ customProfile: { ...CUSTOM_DEFAULTS } });
  };

  const errors = validateCustomParams(values);
  const deviating = isDeviatingFromDefaults(values);
  const jitterCap = effectiveJitterCapPct(values);
  const showJitterAdvisory = values.jitter > jitterCap;

  const prefillMessage = (() => {
    if (!read) return null;
    switch (read.case) {
      case 'custom':
        return 'Loaded from your primary glove.';
      case 'not_custom': {
        const displayName =
          (read.profileName && PROFILE_DISPLAY_NAMES[read.profileName]) ||
          read.profileName ||
          'an unknown profile';
        return `Your glove is set to ${displayName}. Showing research defaults — these will be saved when you apply.`;
      }
      case 'no_device':
        return 'No glove connected. Showing research defaults.';
      default:
        return null;
    }
  })();

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-primary" />
          <span>Custom Profile</span>
        </CardTitle>
        <CardDescription>
          Configure your own timing, amplitude, and session length
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {prefillMessage && (
          <p className="text-sm text-muted-foreground">{prefillMessage}</p>
        )}

        {deviating && (
          <div className="flex items-center justify-between gap-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm text-amber-600 dark:text-amber-400">
              These settings differ from the researched therapy configuration.
            </p>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Reset to research defaults
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {NUMERIC_FIELDS.map((field) => {
            const bounds = CUSTOM_BOUNDS[field];
            const inputId = `custom-profile-${field}`;
            return (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={inputId}>{bounds.label}</Label>
                <Input
                  id={inputId}
                  type="number"
                  min={bounds.min}
                  max={bounds.max}
                  step={bounds.step}
                  value={values[field]}
                  onChange={(e) => handleFieldChange(field, e.target.value)}
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4">
          <Switch
            id="custom-profile-mirror"
            checked={values.mirror}
            onCheckedChange={handleMirrorChange}
          />
          <Label htmlFor="custom-profile-mirror">Mirror across both gloves</Label>
        </div>

        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((error) => (
              <p key={error} className="text-sm text-destructive">
                {error}
              </p>
            ))}
          </div>
        )}

        {showJitterAdvisory && (
          <p
            data-testid="jitter-advisory"
            className="text-sm text-muted-foreground"
          >
            At this burst gap, jitter is effectively capped at{' '}
            {jitterCap.toFixed(1)}%.
          </p>
        )}

        <DerivedTiming values={values} motors={read?.motors ?? null} />

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={doRead}
            disabled={isReading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-read from glove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DerivedTiming({
  values,
  motors,
}: {
  values: CustomProfileParams;
  motors: number | null;
}) {
  if (motors !== null) {
    const { slotMs, periodMs, hz } = crTiming(values, motors);
    return (
      <p data-testid="derived-timing" className="text-sm text-muted-foreground">
        Slot {slotMs} ms · CR period {periodMs} ms ({hz.toFixed(2)} Hz)
      </p>
    );
  }

  const four = crTiming(values, 4);
  const five = crTiming(values, 5);
  return (
    <p data-testid="derived-timing" className="text-sm text-muted-foreground">
      Slot {four.slotMs} ms · CR period {four.periodMs} ms (
      {four.hz.toFixed(2)} Hz) on 4 motors, {five.periodMs} ms (
      {five.hz.toFixed(2)} Hz) on 5
    </p>
  );
}
