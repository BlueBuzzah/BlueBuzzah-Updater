import { describe, expect, it } from 'vitest';
import { needsTermsAcceptance, TERMS_EFFECTIVE_DATE } from './legal';

describe('needsTermsAcceptance', () => {
  it('is satisfied by the current effective date', () => {
    expect(needsTermsAcceptance(TERMS_EFFECTIVE_DATE)).toBe(false);
  });

  it('re-prompts when the Terms date changed', () => {
    expect(needsTermsAcceptance('2025-01-01')).toBe(true);
  });

  it('prompts on first launch', () => {
    expect(needsTermsAcceptance(null)).toBe(true);
    expect(needsTermsAcceptance(undefined)).toBe(true);
  });
});
