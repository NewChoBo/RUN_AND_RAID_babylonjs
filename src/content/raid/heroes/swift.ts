import { chartStats } from '../base-stats.ts';
import { standardContact } from '../projectile-contact.ts';

export const stats = { ...chartStats.swift, power: 8, reach: 3.2, radius: 2.6 } as const;
export const crossSlash = {
  reach: 15,
  speed: 18,
  angles: [0],
  pierces: true,
  contact: { ...standardContact, halfWidth: 1.35 },
} as const;
