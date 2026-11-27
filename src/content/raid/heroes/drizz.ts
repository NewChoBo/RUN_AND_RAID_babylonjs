import { standardContact } from '../projectile-contact.ts';

export const stats = { hp: 134, power: 10, reach: 3, cooldown: 24, radius: 2.4 } as const;
export const grasp = {
  reach: 14,
  speed: 23,
  angles: [0],
  pierces: false,
  contact: { ...standardContact, maxHeight: 2 },
} as const;
