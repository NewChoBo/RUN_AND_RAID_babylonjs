import type { ORIGINAL_HERO_IDS } from '../../game/raid/heroes/hero-id.ts';

// The cafe chart (3424) publishes bars, not absolute values. These scales are in game units.
const health = { 2: 105, 3: 115, 4: 140, 5: 155 };
const basicDamage = { 3: 10, 4: 12, 5: 14 };
const attackIntervalTicks = { 3: 26, 4: 24, 5: 22 };

function rated(
  hp: keyof typeof health,
  attack: keyof typeof basicDamage,
  speed: keyof typeof attackIntervalTicks,
) {
  return { hp: health[hp], basicAttack: basicDamage[attack], cooldown: attackIntervalTicks[speed] };
}

export const chartStats = {
  hammer: rated(4, 4, 4),
  longshot: rated(3, 3, 4),
  flare: rated(2, 3, 3),
  hof: rated(3, 3, 3),
  alice: rated(2, 3, 3),
  kali: rated(3, 3, 5),
  kaiken: rated(3, 4, 5),
  abyss: rated(2, 3, 3),
  froze: rated(3, 3, 5),
  magnus: rated(5, 5, 3),
  swift: rated(4, 4, 4),
  rildin: rated(4, 4, 4),
  jade: rated(2, 3, 3),
  theresa: rated(4, 4, 4),
  drizz: rated(4, 4, 4),
  vallet: rated(3, 3, 4),
} satisfies Record<
  Exclude<(typeof ORIGINAL_HERO_IDS)[number], 'freesia'>,
  ReturnType<typeof rated>
>;
