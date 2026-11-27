export const ORIGINAL_HERO_IDS = [
  'hammer',
  'longshot',
  'flare',
  'alice',
  'hof',
  'kali',
  'kaiken',
  'abyss',
  'froze',
  'magnus',
  'swift',
  'rildin',
  'jade',
  'theresa',
  'drizz',
  'vallet',
  'freesia',
] as const;
export const PRACTICE_HERO_IDS = ['rend', 'bastion', 'rime'] as const;
export const KIT_IDS = [...ORIGINAL_HERO_IDS, ...PRACTICE_HERO_IDS] as const;
export type HeroKit = (typeof KIT_IDS)[number];

/** These source groups have their own bodies. Their original champion roles are unconfirmed. */
export const borrowedKits = {
  airi: 'theresa',
  bird: 'freesia',
  demon: 'flare',
  demonslayer: 'drizz',
  dwight: 'abyss',
  elfprince: 'froze',
  ella: 'freesia',
  ent: 'freesia',
  general: 'hammer',
  goblin: 'hof',
  orc: 'hammer',
  shaman: 'theresa',
  silurian: 'swift',
} as const satisfies Record<string, HeroKit>;
type ArchiveHero = keyof typeof borrowedKits;
export type RaidHero = HeroKit | ArchiveHero;
export const HERO_IDS = [
  ...ORIGINAL_HERO_IDS,
  ...(Object.keys(borrowedKits) as ArchiveHero[]),
  ...PRACTICE_HERO_IDS,
];
export function heroKit(hero: RaidHero): HeroKit {
  return Object.hasOwn(borrowedKits, hero) ? borrowedKits[hero as ArchiveHero] : (hero as HeroKit);
}
