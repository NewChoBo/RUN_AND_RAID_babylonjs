import { chartStats } from '../base-stats.ts';
import { standardContact } from '../projectile-contact.ts';

export const stats = { ...chartStats.kaiken, power: 9, radius: 3.1 } as const;
export const crescent = {
  reach: 13,
  speed: 19,
  angles: [0],
  pierces: true,
  contact: { ...standardContact, halfWidth: 3, maxHeight: 0.48 },
} as const;
export const risingMoon = {
  reach: 12,
  speed: 16,
  angles: [-0.34, 0, 0.34],
  hitPerArrow: true,
  repeatHitScale: 0.4,
  pierces: true,
  contact: { ...standardContact, halfWidth: 1 },
} as const;
