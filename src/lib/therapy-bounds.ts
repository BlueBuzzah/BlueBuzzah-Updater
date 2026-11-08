/**
 * Custom therapy profile bounds, defaults, and derived timing.
 *
 * Every number here is copied from the firmware, which is the sole validator:
 * - bounds: BlueBuzzah-Firmware include/config.h PARAM_*, MAX_AMPLITUDE
 * - defaults: the built-in custom_vcr profile in src/profile_manager.cpp
 * - CR period: therapy_engine.cpp - fingers * (ON + OFF); the macrocycle grid period is 5 times that
 * - onset jitter limit: therapy_engine.cpp onsetJitterLimitMs, with MIN_INTER_BURST_GAP_MS
 *   and ONSET_ROUNDING_RESERVE_MS from include/config.h
 *
 * The Updater duplicates the bounds only so inputs can constrain and the panel
 * can warn early. Firmware still rejects anything out of range; this module can
 * never widen what the device accepts.
 */

/** The seven user-editable Custom profile parameters. */
export interface CustomProfileParams {
  /** Burst duration, ms (firmware key ON). */
  on: number;
  /** Burst gap, ms (firmware key OFF). */
  off: number;
  /** Jitter, percent (firmware key JITTER). */
  jitter: number;
  /** Minimum amplitude, percent (firmware key AMPMIN). */
  ampMin: number;
  /** Maximum amplitude, percent (firmware key AMPMAX). */
  ampMax: number;
  /** Session length, minutes (firmware key SESSION). */
  session: number;
  /** Mirror the pattern across both gloves (firmware key MIRROR). */
  mirror: boolean;
}

/**
 * Identical to the firmware's built-in custom_vcr profile, which equals
 * regular_vcr: the timing of the regular vCR arm in Pfeifer et al. 2021 (no
 * jitter, non-mirrored), which the study ran on four fingers per hand without
 * the thumb. Amplitude is the firmware's full default, not a study value (the study
 * reported displacement in mm). Frequency is fixed by firmware and the Updater
 * never sends it. The bounds around these values are a hardware-safety and
 * coherence envelope, not an efficacy range.
 */
export const CUSTOM_DEFAULTS: CustomProfileParams = {
  on: 100,
  off: 67,
  jitter: 0,
  ampMin: 100,
  ampMax: 100,
  session: 120,
  mirror: false,
};

/**
 * The Custom defaults before issue #23 (the Hybrid pattern). Every field blur
 * saved them to settings, so many saved profiles are this exact object without
 * the user having changed anything.
 */
export const LEGACY_CUSTOM_DEFAULTS: CustomProfileParams = {
  on: 100,
  off: 67,
  jitter: 23.5,
  ampMin: 70,
  ampMax: 100,
  session: 120,
  mirror: false,
};

/** True when every field equals the pre-#23 defaults. */
export function isLegacyDefaults(p: CustomProfileParams): boolean {
  return (Object.keys(LEGACY_CUSTOM_DEFAULTS) as (keyof CustomProfileParams)[]).every(
    (key) => p[key] === LEGACY_CUSTOM_DEFAULTS[key]
  );
}

/** Numeric field keys — `mirror` is a boolean and has no bounds entry. */
export type CustomNumericField = Exclude<keyof CustomProfileParams, 'mirror'>;

export interface FieldBounds {
  min: number;
  max: number;
  step: number;
  unit: string;
  label: string;
}

export const CUSTOM_BOUNDS: Record<CustomNumericField, FieldBounds> = {
  on: { min: 50, max: 200, step: 1, unit: 'milliseconds', label: 'Buzz length' },
  off: { min: 30, max: 200, step: 1, unit: 'milliseconds', label: 'Pause between buzzes' },
  jitter: { min: 0, max: 50, step: 0.5, unit: '%', label: 'Timing variation' },
  ampMin: { min: 20, max: 100, step: 1, unit: '%', label: 'Lowest strength' },
  ampMax: { min: 20, max: 100, step: 1, unit: '%', label: 'Highest strength' },
  session: { min: 1, max: 240, step: 1, unit: 'minutes', label: 'Session length' },
};

/** Smallest inter-burst gap the onset jitter limit leaves, ms (firmware MIN_INTER_BURST_GAP_MS). */
const MIN_INTER_BURST_GAP_MS = 5;

/** Millisecond rounding margin kept out of the onset jitter limit (firmware ONSET_ROUNDING_RESERVE_MS). */
const ONSET_ROUNDING_RESERVE_MS = 1;

const NUMERIC_FIELDS: CustomNumericField[] = [
  'on',
  'off',
  'jitter',
  'ampMin',
  'ampMax',
  'session',
];

/**
 * Fields the backend deserializes into integers (`u8`/`u16` in
 * `src-tauri/src/settings.rs`). A decimal reaches serde as a float and is
 * rejected at the Tauri boundary with a type error the user cannot act on, so
 * it has to be caught here. ON/OFF/JITTER are `f32` and accept decimals.
 */
const INTEGER_FIELDS: CustomNumericField[] = ['ampMin', 'ampMax', 'session'];

/** "50–200 milliseconds", "0–50%": the range in words for a field's hint. */
export function rangeHint(b: FieldBounds): string {
  return `${b.min}–${b.max}${b.unit === '%' ? '%' : ` ${b.unit}`}`;
}

export type CustomParamErrors = Partial<Record<CustomNumericField, string>>;

/**
 * Validate every field against the firmware bounds.
 *
 * @returns One message per invalid field, keyed by field, saying how to fix
 * it (TextField README). Empty object means valid.
 */
export function validateCustomParams(p: CustomProfileParams): CustomParamErrors {
  const errors: CustomParamErrors = {};

  for (const field of NUMERIC_FIELDS) {
    const { min, max } = CUSTOM_BOUNDS[field];
    const value = p[field];
    if (!Number.isFinite(value) || value < min || value > max) {
      errors[field] = `Enter a number from ${min} to ${max}.`;
    } else if (INTEGER_FIELDS.includes(field) && !Number.isInteger(value)) {
      errors[field] = `Enter a whole number, like ${min}.`;
    }
  }

  if (!errors.ampMin && !errors.ampMax && p.ampMin > p.ampMax) {
    errors.ampMax = "Lowest strength can't be higher than highest strength.";
  }

  return errors;
}

/** True when any field differs from the defaults. */
export function isDeviatingFromDefaults(p: CustomProfileParams): boolean {
  return (
    p.on !== CUSTOM_DEFAULTS.on ||
    p.off !== CUSTOM_DEFAULTS.off ||
    p.jitter !== CUSTOM_DEFAULTS.jitter ||
    p.ampMin !== CUSTOM_DEFAULTS.ampMin ||
    p.ampMax !== CUSTOM_DEFAULTS.ampMax ||
    p.session !== CUSTOM_DEFAULTS.session ||
    p.mirror !== CUSTOM_DEFAULTS.mirror
  );
}

/**
 * The largest jitter percentage the current ON/OFF pair can express before
 * firmware limits the onset shift.
 *
 * Firmware limits rather than rejects (onsetJitterLimitMs), so a value above
 * this is guidance, not a validation error. The onset shift is capped at
 * (OFF - MIN_INTER_BURST_GAP_MS - ONSET_ROUNDING_RESERVE_MS) / 2 ms, which is
 * 100 * max(0, OFF - 6) / (ON + OFF) percent of the grid slot. Clamped to the
 * field maximum because a cap above 50 % is not reachable and reads as noise.
 */
export function effectiveJitterCapPct(p: CustomProfileParams): number {
  const slotMs = p.on + p.off;
  if (slotMs <= 0) return 0;
  const maxOnsetShiftMs = Math.max(0, (p.off - MIN_INTER_BURST_GAP_MS - ONSET_ROUNDING_RESERVE_MS) / 2);
  const cap = (2 * 100 * maxOnsetShiftMs) / slotMs;
  return Math.min(cap, CUSTOM_BOUNDS.jitter.max);
}
