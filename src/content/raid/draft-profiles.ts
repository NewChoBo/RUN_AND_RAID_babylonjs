import type { RaidHero } from '../../game/raid/heroes/hero-id.ts';

// Slots with newly authored names or rules. Historical evidence and open questions are in docs/ORIGINAL-ROSTER.md.
export const adaptedSkills: Partial<Record<RaidHero, readonly number[]>> = {
  hammer: [3],
  abyss: [0, 1, 2, 3],
  longshot: [0, 1, 2, 3],
  drizz: [0, 2, 3],
  flare: [2, 3],
  hof: [0, 1, 2, 3],
  froze: [2, 3],
  magnus: [0, 1, 2],
  theresa: [0, 1, 2, 3],
  vallet: [0, 1, 2, 3],
  freesia: [0, 1, 2, 3],
};
