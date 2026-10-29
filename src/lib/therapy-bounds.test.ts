import { describe, expect, it } from 'vitest';
import {
  CUSTOM_BOUNDS,
  CUSTOM_DEFAULTS,
  effectiveJitterCapPct,
  isDeviatingFromDefaults,
  validateCustomParams,
  rangeHint,
  type CustomProfileParams,
} from './therapy-bounds';

/** A valid params object with one field overridden. */
function withField(
  field: keyof CustomProfileParams,
  value: number | boolean
): CustomProfileParams {
  return { ...CUSTOM_DEFAULTS, [field]: value } as CustomProfileParams;
}

describe('CUSTOM_DEFAULTS', () => {
  it('matches the firmware custom_vcr profile', () => {
    expect(CUSTOM_DEFAULTS).toEqual({
      on: 100,
      off: 67,
      jitter: 23.5,
      ampMin: 70,
      ampMax: 100,
      session: 120,
      mirror: false,
    });
  });
});

describe('CUSTOM_BOUNDS', () => {
  it('matches the firmware parameter bounds', () => {
    expect(CUSTOM_BOUNDS.on.min).toBe(50);
    expect(CUSTOM_BOUNDS.on.max).toBe(200);
    expect(CUSTOM_BOUNDS.off.min).toBe(30);
    expect(CUSTOM_BOUNDS.off.max).toBe(200);
    expect(CUSTOM_BOUNDS.jitter.min).toBe(0);
    expect(CUSTOM_BOUNDS.jitter.max).toBe(50);
    expect(CUSTOM_BOUNDS.ampMin.min).toBe(20);
    expect(CUSTOM_BOUNDS.ampMin.max).toBe(100);
    expect(CUSTOM_BOUNDS.ampMax.min).toBe(20);
    expect(CUSTOM_BOUNDS.ampMax.max).toBe(100);
    expect(CUSTOM_BOUNDS.session.min).toBe(1);
    expect(CUSTOM_BOUNDS.session.max).toBe(240);
  });
});

describe('validateCustomParams', () => {
  it('accepts the defaults', () => {
    expect(validateCustomParams(CUSTOM_DEFAULTS)).toEqual({});
  });

  it.each([
    ['on', 49],
    ['on', 201],
    ['off', 29],
    ['off', 201],
    ['jitter', 51],
    ['jitter', -1],
    ['ampMin', 19],
    ['ampMax', 101],
    ['session', 0],
    ['session', 241],
  ] as const)('rejects %s = %d', (field, value) => {
    expect(validateCustomParams(withField(field, value))[field]).toBe(
      `Enter a number from ${CUSTOM_BOUNDS[field].min} to ${CUSTOM_BOUNDS[field].max}.`
    );
  });

  it.each([
    ['on', 50],
    ['on', 200],
    ['off', 30],
    ['off', 200],
    ['jitter', 0],
    ['jitter', 50],
    ['session', 1],
    ['session', 240],
  ] as const)('accepts the boundary value %s = %d', (field, value) => {
    expect(validateCustomParams(withField(field, value))).toEqual({});
  });

  it('rejects ampMin greater than ampMax', () => {
    const errors = validateCustomParams({ ...CUSTOM_DEFAULTS, ampMin: 90, ampMax: 80 });
    expect(errors.ampMax).toBe("Lowest strength can't be higher than highest strength.");
    expect(errors.ampMin).toBeUndefined();
  });

  it('accepts ampMin equal to ampMax', () => {
    expect(validateCustomParams({ ...CUSTOM_DEFAULTS, ampMin: 80, ampMax: 80 })).toEqual({});
  });

  it('rejects a non-finite value', () => {
    const errors = validateCustomParams(withField('on', Number.NaN));
    expect(errors.on).toBe('Enter a number from 50 to 200.');
  });

  // ampMin/ampMax/session deserialize into u8/u16, so a decimal that passes
  // here fails at the Tauri boundary with an unactionable serde type error.
  it.each(['ampMin', 'ampMax', 'session'] as const)(
    'rejects a fractional %s',
    (field) => {
      const errors = validateCustomParams(withField(field, 70.5));
      expect(errors[field]).toBe(`Enter a whole number, like ${CUSTOM_BOUNDS[field].min}.`);
    }
  );

  it('uses plain labels and spelled-out units in the range hint', () => {
    expect(CUSTOM_BOUNDS.on.label).toBe('Buzz length');
    expect(rangeHint(CUSTOM_BOUNDS.on)).toBe('50–200 milliseconds');
    expect(rangeHint(CUSTOM_BOUNDS.jitter)).toBe('0–50%');
    expect(rangeHint(CUSTOM_BOUNDS.session)).toBe('1–240 minutes');
  });

  it('accepts a fractional jitter, which the backend takes as f32', () => {
    expect(validateCustomParams(withField('jitter', 23.5))).toEqual({});
  });
});

describe('isDeviatingFromDefaults', () => {
  it('is false for the exact default set', () => {
    expect(isDeviatingFromDefaults({ ...CUSTOM_DEFAULTS })).toBe(false);
  });

  it.each([
    ['on', 101],
    ['off', 68],
    ['jitter', 0],
    ['ampMin', 71],
    ['ampMax', 99],
    ['session', 60],
    ['mirror', true],
  ] as const)('is true when %s changes to %s', (field, value) => {
    expect(isDeviatingFromDefaults(withField(field, value))).toBe(true);
  });
});

describe('effectiveJitterCapPct', () => {
  it('reports no cap when the gap absorbs the excursion', () => {
    // slot 167, jitter 23.5% -> excursion 19.6ms; off 67 leaves 62ms of headroom
    expect(effectiveJitterCapPct(CUSTOM_DEFAULTS)).toBeGreaterThanOrEqual(50);
  });

  it('caps jitter when off is near the minimum inter-burst gap', () => {
    // off = 30 -> maxExcursion = 25ms; slot = 130 -> cap = 2*100*25/130 = 38.46%
    const cap = effectiveJitterCapPct({ ...CUSTOM_DEFAULTS, on: 100, off: 30 });
    expect(cap).toBeCloseTo(38.46, 1);
  });
});
