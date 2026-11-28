import entries from './draft-catalog.json' with { type: 'json' };
import { battleOutfit } from './battle-outfits.ts';
import type { RaidHero } from '../../game/raid/heroes/hero-id.ts';
import { swiftRageBonusPercent, type RaidRageLoadout } from './rage.ts';

export type CatalogHero = keyof typeof entries;
export function hasDraftCatalog(hero: RaidHero): hero is CatalogHero {
  return Object.hasOwn(entries, hero);
}
export const draftCatalog = entries;
export function selectableSkins(hero: CatalogHero) {
  return entries[hero].skins.filter((skin) => battleOutfit(hero, hero + '/' + skin.modelSkin));
}

// The June 17 patch doubled the published unlocks. Keep the rounded 1.88 source values explicit.
export const skinEffects = {
  hp: ['statHp', '+40'],
  resist: ['statResist', '+7.5'],
  armor: ['statArmor', '+7.5'],
  attack: ['statAttack', '+1.88 × 2'],
  pierce: ['statPierce', '+9.6%'],
  speed: ['statSpeed', '+3%'],
  magicPierce: ['statMagicPierce', '+12%'],
  power: ['statPower', '+6'],
  cooldown: ['statCooldown', '−3%'],
  move: ['statMove', '+0.9%'],
  drain: ['statDrain', '+1.88% × 2'],
  rage: ['statRage', `+${swiftRageBonusPercent}%`],
} as const;
export function effectFor(key: string | null) {
  if (key && Object.hasOwn(skinEffects, key)) return skinEffects[key as keyof typeof skinEffects];
}

const gearIcons = {
  sword:
    'https://cafeptthumb-phinf.pstatic.net/20140424_295/chivalrykgt_1398331683688MMcMK_PNG/sword0.png?type=w800',
  necklace:
    'https://cafeptthumb-phinf.pstatic.net/20140424_78/chivalrykgt_1398331786894GMFzX_PNG/amulet0.png?type=w800',
  helmet:
    'https://cafeptthumb-phinf.pstatic.net/20140424_244/chivalrykgt_1398331982881NHRC5_PNG/helmet0.png?type=w800',
  armor:
    'https://cafeptthumb-phinf.pstatic.net/20140424_75/chivalrykgt_1398331869739RqapD_PNG/armor0.png?type=w800',
  shield:
    'https://cafeptthumb-phinf.pstatic.net/20140424_132/chivalrykgt_1398331811926l3Hsb_PNG/buckler1.png?type=w800',
  staff:
    'https://cafeptthumb-phinf.pstatic.net/20140424_220/chivalrykgt_1398331716703nmBYc_PNG/staff2.png?type=w800',
  cloak:
    'https://cafeptthumb-phinf.pstatic.net/20140424_291/chivalrykgt_139833184783597zQp_PNG/cloak1.png?type=w800',
  earring:
    'https://cafeptthumb-phinf.pstatic.net/20140424_23/chivalrykgt_1398331930470oKSGG_PNG/earring3.png?type=w800',
};
export const equipmentPages = {
  empty: [],
  darkKnight: [
    { item: 'sword', stats: [['statAttack', '+8.65']] },
    { item: 'necklace', stats: [['statMagicPierce', '+27%']] },
    { item: 'helmet', stats: [['statRegen', '+17%']] },
    { item: 'armor', stats: [['statHp', '+93.5']] },
  ],
  kaikenSet: [
    { item: 'shield', stats: [['statArmor', '+18.2']] },
    { item: 'staff', stats: [['statPower', '+16.8']] },
    { item: 'cloak', stats: [['statResist', '+19.5']] },
    {
      item: 'earring',
      stats: [
        ['statDrain', '+11.7%'],
        ['statSkillDrain', '+9.36%'],
      ],
    },
  ],
} as const;
export type GearPage = keyof typeof equipmentPages;
export const gearIcon = (item: keyof typeof gearIcons) => gearIcons[item];
export interface DraftPreset {
  ranks: [number, number, number];
  art: string;
  option: string;
  gear: GearPage;
}

export function draftPreset(hero: CatalogHero, saved?: Partial<DraftPreset> | null): DraftPreset {
  const skins = selectableSkins(hero);
  const first = skins[0]!.art;
  const ranks = saved?.ranks;
  return {
    ranks:
      Array.isArray(ranks) &&
      ranks.length === 3 &&
      ranks.every((n) => Number.isInteger(n) && n >= 1 && n <= 4) &&
      ranks.reduce((sum, n) => sum + n, 0) <= 6
        ? [...ranks]
        : [1, 1, 1],
    art: skins.find((s) => s.art === saved?.art)?.art ?? first,
    option: skins.find((s) => s.effect && s.art === saved?.option)?.art ?? first,
    gear:
      typeof saved?.gear === 'string' && Object.hasOwn(equipmentPages, saved.gear)
        ? saved.gear
        : hero === 'hammer'
          ? 'darkKnight'
          : hero === 'kaiken'
            ? 'kaikenSet'
            : 'empty',
  };
}
export function remainingPoints(preset: DraftPreset) {
  return 6 - preset.ranks.reduce((sum, n) => sum + n, 0);
}

export function draftRageLoadout(
  hero: CatalogHero,
  preset: DraftPreset,
): RaidRageLoadout | undefined {
  if (hero === 'rildin' && preset.ranks[1] > 1) return { counterRank: preset.ranks[1] };
  if (
    hero === 'swift' &&
    draftCatalog.swift.skins.some((s) => s.art === preset.option && s.effect === 'rage')
  )
    return { swiftRageBonus: true };
}
