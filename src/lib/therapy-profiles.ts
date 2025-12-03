import type { TherapyProfileInfo } from '@/types';

/**
 * Available therapy profiles for BlueBuzzah devices.
 *
 * Profile mappings:
 * - REGULAR → regular_vcr: Default vCR, non-mirrored, no jitter
 * - NOISY → noisy_vcr: Mirrored with 23.5% jitter
 * - HYBRID → hybrid_vcr: Non-mirrored with 23.5% jitter
 * - GENTLE → gentle: Lower amplitude, sequential pattern
 */
export const THERAPY_PROFILES: TherapyProfileInfo[] = [
  {
    id: 'REGULAR',
    name: 'Regular',
    description: 'Default vCR pattern - non-mirrored, no jitter',
  },
  {
    id: 'NOISY',
    name: 'Noisy',
    description: 'Mirrored pattern with 23.5% jitter for varied stimulation',
  },
  {
    id: 'HYBRID',
    name: 'Hybrid',
    description: 'Non-mirrored pattern with 23.5% jitter',
  },
  {
    id: 'GENTLE',
    name: 'Gentle',
    description: 'Lower amplitude with sequential pattern for sensitive users',
  },
];

/**
 * Get profile info by ID.
 */
export function getProfileInfo(profileId: string): TherapyProfileInfo | undefined {
  return THERAPY_PROFILES.find((p) => p.id === profileId);
}
