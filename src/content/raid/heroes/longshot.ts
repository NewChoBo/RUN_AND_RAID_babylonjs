import { chartStats } from '../base-stats.ts';
import { standardContact } from '../projectile-contact.ts';

export const stats = { ...chartStats.longshot, power: 8, reach: 12, radius: 2.8 } as const;
export const scatter = {
  reach: 15,
  speed: 15,
  angles: Array.from({ length: 7 }, (_, i) => ((i - 3) * Math.PI) / 25),
  guide: 'sector',
  hitPerArrow: true,
  repeatHitScale: 0.2,
  pierces: false,
  contact: standardContact,
} as const;
export const piercing = {
  pierceScale: 0.5,
  reach: 20,
  speed: 21,
  angles: [0],
  pierces: true,
  contact: standardContact,
} as const;
