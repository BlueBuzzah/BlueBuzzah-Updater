/**
 * Custom therapy profile bounds, defaults, and derived timing.
 *
 * Every number here is copied from the firmware, which is the sole validator:
 * - bounds: BlueBuzzah-Firmware include/config.h:197-206, MAX_AMPLITUDE (config.h:185)
 * - defaults: the built-in custom_vcr profile, src/profile_manager.cpp:138-155
 * - CR period: therapy_engine.cpp generateRandomPermutation - fingers * (ON + OFF)
 * - jitter clamp: therapy_engine.cpp clampedJitterAmount + MIN_INTER_BURST_GAP_MS
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
 * The Pfeifer et al. 2021 research protocol values, identical to the firmware's
 * built-in custom_vcr profile. The bounds around them are a hardware-safety and
 * coherence envelope, NOT a validated efficacy range.
 */
export const CUSTOM_DEFAULTS: CustomProfileParams = {
  on: 100,
  off: 67,
  jitter: 23.5,
  ampMin: 70,
  ampMax: 100,
  session: 120,
  mirror: false,
};

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
  on: { min: 50, max: 200, step: 1, unit: 'ms', label: 'Burst duration' },
  off: { min: 30, max: 200, step: 1, unit: 'ms', label: 'Burst gap' },
  jitter: { min: 0, max: 50, step: 0.5, unit: '%', label: 'Jitter' },
  ampMin: { min: 20, max: 100, step: 1, unit: '%', label: 'Amplitude min' },
  ampMax: { min: 20, max: 100, step: 1, unit: '%', label: 'Amplitude max' },
  session: { min: 1, max: 240, step: 1, unit: 'min', label: 'Session length' },
};

/** Smallest inter-burst gap the jitter excursion may leave (config.h:211). */
const MIN_INTER_BURST_GAP_MS = 5;

const NUMERIC_FIELDS: CustomNumericField[] = [
  'on',
  'off',
  'jitter',
  'ampMin',
  'ampMax',
  'session',
];

/**
 * Validate every field against the firmware bounds.
 *
 * @returns Human-readable messages, one per violation. Empty array means valid.
 */
export function validateCustomParams(p: CustomProfileParams): string[] {
  const errors: string[] = [];

  for (const field of NUMERIC_FIELDS) {
    const bounds = CUSTOM_BOUNDS[field];
    const value = p[field];

    if (!Number.isFinite(value)) {
      errors.push(`${bounds.label} must be a number.`);
      continue;
    }
    if (value < bounds.min || value > bounds.max) {
      errors.push(
        `${bounds.label} must be between ${bounds.min} and ${bounds.max} ${bounds.unit}.`
      );
    }
  }

  if (
    Number.isFinite(p.ampMin) &&
    Number.isFinite(p.ampMax) &&
    p.ampMin > p.ampMax
  ) {
    errors.push('Amplitude min must not exceed amplitude max.');
  }

  return errors;
}

/** True when any field differs from the research defaults. */
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
 * Coordinated-reset timing derived from the burst parameters.
 *
 * Mirrors therapy_engine.cpp: one fingertip slot is ON + OFF, and a full
 * coordinated-reset cycle covers every fingertip once.
 */
export function crTiming(
  p: CustomProfileParams,
  fingers: number
): { slotMs: number; periodMs: number; hz: number } {
  const slotMs = Math.round(p.on + p.off);
  const periodMs = Math.round(fingers * (p.on + p.off));
  const hz = periodMs > 0 ? 1000 / periodMs : 0;
  return { slotMs, periodMs, hz };
}

/**
 * The largest jitter percentage the current ON/OFF pair can express before
 * firmware clamps the excursion.
 *
 * Firmware clamps rather than rejects (clampedJitterAmount), so a value above
 * this is guidance, not a validation error. Clamped to the field maximum
 * because a cap above 50 % is not reachable and reads as noise.
 */
export function effectiveJitterCapPct(p: CustomProfileParams): number {
  const slotMs = p.on + p.off;
  if (slotMs <= 0) return 0;
  const maxExcursion = Math.max(0, p.off - MIN_INTER_BURST_GAP_MS);
  const cap = (2 * 100 * maxExcursion) / slotMs;
  return Math.min(cap, CUSTOM_BOUNDS.jitter.max);
}
