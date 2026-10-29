import { useEffect, useRef, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/icon';
import { Switch } from '@/components/ui/switch';
import { TextField } from '@/components/ui/text-field';
import {
  CUSTOM_BOUNDS,
  CUSTOM_DEFAULTS,
  effectiveJitterCapPct,
  isDeviatingFromDefaults,
  rangeHint,
  validateCustomParams,
  type CustomNumericField,
  type CustomProfileParams,
} from '@/lib/therapy-bounds';
import { therapyService } from '@/services/TherapyService';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CustomProfileRead } from '@/types';

/** Firmware profile name -> display name, for the "not_custom" prefill message. */
const PROFILE_DISPLAY_NAMES: Record<string, string> = {
  regular_vcr: 'Regular',
  noisy_vcr: 'Noisy',
  hybrid_vcr: 'Hybrid',
  gentle: 'Gentle',
};

const NUMERIC_FIELDS: CustomNumericField[] = ['on', 'off', 'jitter', 'ampMin', 'ampMax', 'session'];
const INTEGER_FIELDS = new Set<CustomNumericField>(['ampMin', 'ampMax', 'session']);

// A missing or invalid saved number shows as an empty field, never "null" or "NaN".
const show = (n: number) => (Number.isFinite(n) ? String(n) : '');
const toRaw = (v: CustomProfileParams) =>
  Object.fromEntries(NUMERIC_FIELDS.map((f) => [f, show(v[f])])) as Record<CustomNumericField, string>;
const parse = (raw: string) => (raw.trim() === '' ? Number.NaN : Number(raw));

export function CustomProfilePanel(): JSX.Element {
  const { settings, setSettings } = useSettingsStore();
  const values: CustomProfileParams = settings.customProfile ?? CUSTOM_DEFAULTS;
  const [raw, setRaw] = useState(() => toRaw(values));
  const [focused, setFocused] = useState<CustomNumericField | null>(null);
  const [beforeReset, setBeforeReset] = useState<CustomProfileParams | null>(null);
  const [read, setRead] = useState<CustomProfileRead | null>(null);
  const [isReading, setIsReading] = useState(false);
  const hasReadRef = useRef(false);

  // Replace everything shown, e.g. after a device read, a reset or an undo.
  const replaceAll = (next: CustomProfileParams) => {
    setSettings({ customProfile: next });
    setRaw(toRaw(next));
  };

  // Follow store changes made elsewhere (the saved copy loading, a device read),
  // except in the field someone is typing in.
  useEffect(() => {
    setRaw((r) => {
      const changed = NUMERIC_FIELDS.filter((f) => f !== focused && !Object.is(parse(r[f]), values[f]) && r[f] !== show(values[f]));
      return changed.length ? { ...r, ...Object.fromEntries(changed.map((f) => [f, show(values[f])])) } : r;
    });
  }, [values, focused]);

  const doRead = async () => {
    setIsReading(true);
    try {
      const result = await therapyService.readCustomProfile();
      setRead(result);
      // The device is the source of truth for what is actually on the hardware.
      if (result.case === 'custom' && result.values) replaceAll(result.values);
    } catch (error) {
      // 'no_device' is an answer, not a rejection; a rejection is an IPC failure.
      // Prefill is a convenience, so fall back to the defaults without a claim.
      console.error('[CustomProfilePanel] prefill read failed:', error);
      setRead(null);
    } finally {
      setIsReading(false);
    }
  };

  useEffect(() => {
    // Prevent double-execution in React StrictMode (development only)
    if (hasReadRef.current) return;
    hasReadRef.current = true;
    doRead();
  }, []);

  // Validate on blur only (TextField README: don't validate while typing).
  const commit = (field: CustomNumericField) => {
    setSettings({ customProfile: { ...values, [field]: parse(raw[field]) } });
    setFocused(null);
    setBeforeReset(null);
  };

  const errors = validateCustomParams(values);
  // The store only changes on blur or from outside, so this never validates
  // mid-typing; an invalid saved value is highlighted as soon as the panel opens.
  const shownError = (field: CustomNumericField) => (field === focused ? undefined : errors[field]);
  const deviating = isDeviatingFromDefaults(values);
  const jitterCap = effectiveJitterCapPct(values);

  const prefillMessage = (() => {
    switch (read?.case) {
      case 'custom':
        return 'Loaded from your Primary device.';
      case 'not_custom': {
        const name = (read.profileName && PROFILE_DISPLAY_NAMES[read.profileName]) || read.profileName || 'another pattern';
        return `Your device uses ${name}. These are the default settings. They're saved when you apply.`;
      }
      case 'no_device':
        return 'No device connected. Showing the default settings. Plug in your Primary device to load its settings.';
      default:
        return null;
    }
  })();

  return (
    <Card title="Custom Pattern">
      <div className="grid gap-6">
        <p className="body">Set your own timing, strength and session length.</p>
        {prefillMessage && <p className="body-s text-ink-muted" aria-live="polite">{prefillMessage}</p>}

        <div className="grid gap-6 sm:grid-cols-2">
          {NUMERIC_FIELDS.map((field) => (
            <TextField
              key={field}
              label={CUSTOM_BOUNDS[field].label}
              hint={rangeHint(CUSTOM_BOUNDS[field])}
              error={shownError(field)}
              inputMode={INTEGER_FIELDS.has(field) ? 'numeric' : 'decimal'}
              className="tabular-nums"
              value={raw[field]}
              onChange={(e) => setRaw((r) => ({ ...r, [field]: e.target.value }))}
              onFocus={() => setFocused(field)}
              onBlur={() => commit(field)}
            />
          ))}
        </div>

        <Switch
          label="Same order on both devices"
          description="Both devices buzz the same fingers in the same order."
          checked={values.mirror}
          onChange={(mirror) => setSettings({ customProfile: { ...values, mirror } })}
        />

        {values.jitter > jitterCap && (
          <p data-testid="jitter-advisory" className="body-s tabular-nums text-ink-muted">
            With this pause, timing can vary by at most {jitterCap.toFixed(1)}%.
          </p>
        )}

        {(deviating || beforeReset) && (
          <div className="flex flex-wrap items-center justify-between gap-target-gap" aria-live="polite">
            <p className="body-s flex items-center gap-2">
              {beforeReset ? (
                'Settings reset.'
              ) : (
                <>
                  <TriangleAlert size={ICON.s} className="shrink-0 text-warning" />
                  You have changed these values from the defaults.
                </>
              )}
            </p>
            {beforeReset ? (
              <Button variant="quiet" onClick={() => replaceAll(beforeReset)}>Undo</Button>
            ) : (
              <Button
                variant="quiet"
                onClick={() => {
                  const previous = values;
                  replaceAll({ ...CUSTOM_DEFAULTS });
                  setBeforeReset(previous);
                }}
              >
                Reset to Defaults
              </Button>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="quiet" icon={RefreshCw} onClick={doRead} disabled={isReading}>
            Load from Device
          </Button>
        </div>
      </div>
    </Card>
  );
}
