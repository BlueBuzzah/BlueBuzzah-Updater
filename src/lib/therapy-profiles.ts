import type { TherapyProfileInfo } from '@/types';

/**
 * Available therapy profiles for BlueBuzzah devices.
 */
export const THERAPY_PROFILES: TherapyProfileInfo[] = [
  {
    id: 'NOISY',
    name: 'Noisy',
    description:
      'Randomized timing with variable intensity for optimal therapeutic effect',
  },
  {
    id: 'STANDARD',
    name: 'Standard',
    description:
      'Consistent, predictable vibration pattern at full intensity',
  },
  {
    id: 'GENTLE',
    name: 'Gentle',
    description:
      'Softer vibrations with reduced intensity for sensitive users',
  },
];

/**
 * Get profile info by ID.
 */
export function getProfileInfo(profileId: string): TherapyProfileInfo | undefined {
  return THERAPY_PROFILES.find((p) => p.id === profileId);
}
