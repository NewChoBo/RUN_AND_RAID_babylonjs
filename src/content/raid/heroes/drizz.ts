import { chartStats } from '../base-stats.ts';
import { standardContact } from '../projectile-contact.ts';

export const stats = { ...chartStats.drizz, power: 10, radius: 4 } as const;
export const grasp = {
  reach: 14,
  speed: 23,
  angles: [0],
  pierces: false,
  contact: { ...standardContact, halfWidth: 1.5, maxHeight: 2 },
} as const;
