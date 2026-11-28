import type { RaidHero } from '../../game/raid/heroes/hero-id.ts';

// Slots with newly authored names or rules. Historical evidence and open questions are in docs/ORIGINAL-ROSTER.md.
export const adaptedSkills: Partial<Record<RaidHero, readonly number[]>> = {
  abyss: [0, 1, 2, 3],
  longshot: [0, 1, 2, 3],
  drizz: [2, 3],
  flare: [0],
  hof: [0, 1, 2, 3],
  froze: [1, 2],
  magnus: [0, 1, 2],
  theresa: [0, 1, 2, 3],
  vallet: [0, 1, 2, 3],
  freesia: [0, 1, 2, 3],
};
