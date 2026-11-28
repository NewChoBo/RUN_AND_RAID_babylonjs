import { heroKit, type HeroKit, type RaidHero } from '../../game/raid/heroes/hero-id.ts';

// HP lost per full meter in the remake. The original guides do not publish these thresholds.
const damageToFull = {
  hammer: 125,
  longshot: 100,
  flare: 95,
  alice: 105,
  hof: 110,
  kali: 100,
  kaiken: 105,
  abyss: 95,
  froze: 110,
  magnus: null,
  swift: 125,
  rildin: 145,
  jade: 100,
  theresa: 135,
  drizz: 130,
  vallet: 105,
  freesia: 90,
  rend: 105,
  bastion: 135,
  rime: 90,
} satisfies Record<HeroKit, number | null>;

export interface RaidRageLoadout {
  readonly counterRank?: number;
  readonly swiftRageBonus?: boolean;
}

export function normalizeRaidRageLoadout(
  hero: RaidHero,
  loadout?: RaidRageLoadout,
): RaidRageLoadout {
  const rank = loadout?.counterRank;
  if (hero === 'rildin' && rank !== undefined && Number.isInteger(rank) && rank >= 2 && rank <= 4)
    return { counterRank: rank };
  if (hero === 'swift' && loadout?.swiftRageBonus === true) return { swiftRageBonus: true };
  return {};
}

export function raidRageDamageToFull(hero: RaidHero) {
  return damageToFull[heroKit(hero)];
}

// The Bunny Girl option originally granted +10%. The June 17 patch doubled skin options.
export const swiftRageBonusPercent = 20;

export function raidRageGain(hero: RaidHero, damage: number, loadout?: RaidRageLoadout) {
  const threshold = raidRageDamageToFull(hero);
  if (threshold === null || damage <= 0) return 0;
  const percent = hero === 'swift' && loadout?.swiftRageBonus ? 100 + swiftRageBonusPercent : 100;
  return (damage * percent) / threshold;
}
