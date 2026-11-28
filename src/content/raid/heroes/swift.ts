import { chartStats } from '../base-stats.ts';
import { standardContact } from '../projectile-contact.ts';

export const stats = { ...chartStats.swift, power: 8, radius: 2.6 } as const;
export const lungeTicks = 6;
// skill3start's throwing hand swings forward between source frames 7 and 8 at 30 fps.
export const daggerReleaseTicks = 8;
export const daggerSpeed = 30;
export const crossSlash = {
  reach: 15,
  speed: 18,
  angles: [0],
  pierces: true,
  contact: { ...standardContact, halfWidth: 3 },
} as const;
