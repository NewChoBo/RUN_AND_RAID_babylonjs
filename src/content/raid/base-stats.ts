import type { ORIGINAL_HERO_IDS } from '../../game/raid/heroes/hero-id.ts';

// The cafe chart (3424) publishes bars, not absolute values. These scales are in game units.
const health = { 2: 105, 3: 115, 4: 140, 5: 155 };
const basicDamage = { 3: 10, 4: 12, 5: 14 };
const attackIntervalTicks = { 3: 26, 4: 24, 5: 22 };

// The distances are calibrated in chase metres; the source publishes only four relative grades.
const basicReach = { 1: 3.5, 2: 4.5, 4: 9, 5: 11 };
function rated(
  hp: keyof typeof health,
  attack: keyof typeof basicDamage,
  speed: keyof typeof attackIntervalTicks,
  range: keyof typeof basicReach,
) {
  return {
    reach: basicReach[range],
    hp: health[hp],
    basicAttack: basicDamage[attack],
    cooldown: attackIntervalTicks[speed],
  };
}

export const chartStats = {
  hammer: rated(4, 4, 4, 1),
  longshot: rated(3, 3, 4, 5),
  flare: rated(2, 3, 3, 5),
  hof: rated(3, 3, 3, 5),
  alice: rated(2, 3, 3, 5),
  kali: rated(3, 3, 5, 1),
  kaiken: rated(3, 4, 5, 2),
  abyss: rated(2, 3, 3, 5),
  froze: rated(3, 3, 5, 2),
  magnus: rated(5, 5, 3, 1),
  swift: rated(4, 4, 4, 1),
  rildin: rated(4, 4, 4, 1),
  jade: rated(2, 3, 3, 5),
  theresa: rated(4, 4, 4, 1),
  drizz: rated(4, 4, 4, 1),
  vallet: rated(3, 3, 4, 4),
} satisfies Record<
  Exclude<(typeof ORIGINAL_HERO_IDS)[number], 'freesia'>,
  ReturnType<typeof rated>
>;
