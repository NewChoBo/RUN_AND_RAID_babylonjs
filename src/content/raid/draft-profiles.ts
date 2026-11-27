import type { RaidHero } from '../../game/raid/heroes/hero-id.ts';

export const pendingProfiles = [
  'airi',
  'bird',
  'demon',
  'demonslayer',
  'dwight',
  'elfprince',
  'ella',
  'ent',
  'general',
  'goblin',
  'orc',
  'shaman',
  'silurian',
] as const;
export type DraftProfile = RaidHero | (typeof pendingProfiles)[number];
export function pendingProfile(id: DraftProfile): id is (typeof pendingProfiles)[number] {
  return pendingProfiles.some((candidate) => candidate === id);
}

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
