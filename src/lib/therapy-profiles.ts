import type { TherapyProfileInfo } from '@/types';

/**
 * Available therapy profiles for BlueBuzzah devices.
 *
 * Profile mappings:
 * - REGULAR → regular_vcr: Default vCR, non-mirrored, no jitter
 * - NOISY → noisy_vcr: Mirrored with 23.5% jitter
 * - HYBRID → hybrid_vcr: Non-mirrored with 23.5% jitter
 * - GENTLE → gentle: Lower amplitude, sequential pattern
 * - CUSTOM → custom_vcr: User-editable parameters (profile ID 4)
 */
export const THERAPY_PROFILES: TherapyProfileInfo[] = [
  {
    id: 'REGULAR',
    name: 'Regular',
    description: 'The standard pattern. Fingers buzz one at a time at a steady pace. Each device follows its own order.',
  },
  {
    id: 'NOISY',
    name: 'Noisy',
    description: 'Like Regular, but the timing varies a little each time. Both devices follow the same order.',
  },
  {
    id: 'HYBRID',
    name: 'Hybrid',
    description: 'Like Regular, but the timing varies a little each time. Each device follows its own order.',
  },
  {
    id: 'GENTLE',
    name: 'Gentle',
    description: 'Softer buzzing. Fingers buzz one after another in a fixed order.',
  },
  {
    id: 'CUSTOM',
    name: 'Custom',
    description: 'Set your own timing, strength and session length.',
  },
];

/**
 * Get profile info by ID.
 */
export function getProfileInfo(profileId: string): TherapyProfileInfo | undefined {
  return THERAPY_PROFILES.find((p) => p.id === profileId);
}
