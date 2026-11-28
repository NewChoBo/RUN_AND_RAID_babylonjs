import { chartStats } from '../base-stats.ts';
import { standardContact } from '../projectile-contact.ts';

export const stats = { ...chartStats.drizz, power: 10, reach: 3, radius: 2.4 } as const;
export const grasp = {
  reach: 14,
  speed: 23,
  angles: [0],
  pierces: false,
  contact: { ...standardContact, maxHeight: 2 },
} as const;
