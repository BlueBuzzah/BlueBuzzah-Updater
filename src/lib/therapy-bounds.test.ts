import { describe, expect, it } from 'vitest';
import {
  CUSTOM_BOUNDS,
  CUSTOM_DEFAULTS,
  crTiming,
  effectiveJitterCapPct,
  isDeviatingFromDefaults,
  validateCustomParams,
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
    expect(validateCustomParams(CUSTOM_DEFAULTS)).toEqual([]);
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
    expect(validateCustomParams(withField(field, value)).length).toBeGreaterThan(0);
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
    expect(validateCustomParams(withField(field, value))).toEqual([]);
  });

  it('rejects ampMin greater than ampMax', () => {
    const errors = validateCustomParams({ ...CUSTOM_DEFAULTS, ampMin: 90, ampMax: 80 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/amplitude/i);
  });

  it('accepts ampMin equal to ampMax', () => {
    expect(validateCustomParams({ ...CUSTOM_DEFAULTS, ampMin: 80, ampMax: 80 })).toEqual([]);
  });

  it('rejects a non-finite value', () => {
    const errors = validateCustomParams(withField('on', Number.NaN));
    expect(errors.length).toBeGreaterThan(0);
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

describe('crTiming', () => {
  it('returns 668 ms / 1.50 Hz for the defaults on 4 motors', () => {
    const t = crTiming(CUSTOM_DEFAULTS, 4);
    expect(t.slotMs).toBe(167);
    expect(t.periodMs).toBe(668);
    expect(t.hz).toBeCloseTo(1.5, 2);
  });

  it('returns 835 ms / 1.20 Hz for the defaults on 5 motors', () => {
    const t = crTiming(CUSTOM_DEFAULTS, 5);
    expect(t.slotMs).toBe(167);
    expect(t.periodMs).toBe(835);
    expect(t.hz).toBeCloseTo(1.2, 2);
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
