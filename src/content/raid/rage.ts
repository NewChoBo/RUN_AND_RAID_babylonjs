import { heroKit, type HeroKit, type RaidHero } from '../../game/raid/heroes/hero-id.ts';

// HP lost per full meter in the remake. The original guides do not publish these thresholds.
const damageToFull = {
  hammer: 200,
  longshot: 160,
  flare: 150,
  alice: 170,
  hof: 175,
  kali: 160,
  kaiken: 170,
  abyss: 150,
  froze: 175,
  magnus: null,
  swift: 200,
  rildin: 230,
  jade: 160,
  theresa: 215,
  drizz: 210,
  vallet: 170,
  freesia: 145,
  rend: 170,
  bastion: 215,
  rime: 145,
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
