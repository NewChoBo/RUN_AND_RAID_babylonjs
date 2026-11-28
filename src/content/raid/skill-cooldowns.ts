import { heroKit, type RaidHero } from '../../game/raid/heroes/hero-id.ts';
import type { Skill } from '../../game/raid/raid-view.ts';
import { RAID_HZ } from '../../game/raid/raid-rules.ts';

// Official skill sheets, with later published cooldown changes applied (see ORIGINAL-ROSTER.md).
const originalCooldowns = {
  hammer: [
    [8, 7, 6, 5],
    [16, 14, 12, 10],
    [14, 13, 12, 11],
  ],
  longshot: [[13, 11, 9, 7], [14], [16, 15, 14, 13]],
  flare: [[8, 7.5, 7, 6.5], [10, 9, 8, 7], [12]],
  alice: [[11, 10, 9, 8], [11], [12, 11, 10, 9]],
  hof: [[15], [15], [16]],
  kali: [[4], [11, 10, 9, 8], [13, 12, 11, 10]],
  kaiken: [[6], [7], [16, 14, 12, 10]],
  abyss: [[9], [12, 11, 10, 9], [23, 20, 17, 14]],
  froze: [[], [], [10, 9, 8, 7]],
  magnus: [
    [17, 16, 15, 14],
    [17, 16, 15, 14],
    [17, 16, 15, 14],
  ],
  swift: [
    [12, 11, 10, 9],
    [13, 12, 11, 10],
    [14, 13, 12, 11],
  ],
  rildin: [[7], [15, 14, 13, 12], [7, 6, 5, 4]],
  jade: [
    [11, 10, 9, 8],
    [11, 10, 9, 8],
    [14, 13, 12, 11],
  ],
  theresa: [
    [12, 11, 10, 9],
    [13, 12, 11, 10],
    [10, 9, 8, 7],
  ],
  drizz: [[15, 14, 13, 12], [8], [8, 7, 6, 5]],
  vallet: [
    [7, 6, 5, 4],
    [9, 8, 7, 6],
    [21, 19, 17, 15],
  ],
  freesia: [[12, 11, 10, 9], [9], [18, 16, 14, 12]],
} as const;

type OriginalHero = keyof typeof originalCooldowns;
type BasicSlot = 0 | 1 | 2;

export function originalCooldownSeconds(hero: OriginalHero, slot: BasicSlot, rank = 1) {
  const times: readonly number[] = originalCooldowns[hero][slot];
  return times.length === 1 ? times[0] : times[rank - 1];
}

export function matchedCooldownTicks(hero: RaidHero, skill: Skill) {
  const kit = heroKit(hero);
  if (skill === 3 || !Object.hasOwn(originalCooldowns, kit)) return;
  const original = kit as OriginalHero;
  const seconds = originalCooldownSeconds(original, skill);
  if (seconds !== undefined) return Math.round(seconds * RAID_HZ);
}
