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
export const HERO_IDS = [...ORIGINAL_HERO_IDS, 'rend', 'bastion', 'rime'] as const;
export type RaidHero = (typeof HERO_IDS)[number];
