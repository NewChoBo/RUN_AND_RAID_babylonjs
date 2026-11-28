import published from './published-outfits.json' with { type: 'json' };
import catalog from './draft-catalog.json' with { type: 'json' };
import illustrations from './illustrations.json' with { type: 'json' };
import { borrowedKits, type RaidHero } from '../../game/raid/heroes/hero-id.ts';
import type { Locale } from '../locales/locale.ts';

const namedSkins = new Map(
  Object.entries(catalog).flatMap(([hero, entry]) =>
    entry.skins.map((skin) => [hero + '/' + skin.modelSkin, skin] as const),
  ),
);
const images = new Map<string, string>();
for (const art of illustrations) if (!images.has(art.caption)) images.set(art.caption, art.image);

// Every released model is visible in the gallery. Original champions need matching artwork
// for a selectable skin. Archive runners keep their own identified base body.
export const outfitCatalog = published.map((model) => {
  const id = model.group + '/' + model.skin;
  const skin = namedSkins.get(id);
  const image = skin && images.get(skin.art);
  const playable = Boolean(
    image || (model.skin === 'default' && Object.hasOwn(borrowedKits, model.group)),
  );
  const portrait =
    skin && model.skin !== 'default'
      ? './assets/raid/skin-previews/' + model.group + '-' + model.skin + '.webp'
      : './assets/raid/portraits/' + model.group + '.webp';
  return { ...model, id, skinInfo: skin, image, portrait, playable };
});
export const battleOutfits = outfitCatalog.filter((o) => o.playable);
const byId = new Map(battleOutfits.map((o) => [o.id, o]));
export function battleOutfit(hero: RaidHero, id: unknown) {
  const outfit = typeof id === 'string' ? byId.get(id) : undefined;
  return outfit?.group === hero ? outfit : undefined;
}
export function outfitName(outfit: (typeof outfitCatalog)[number], locale: Locale) {
  const skin = outfit.skinInfo;
  if (!skin)
    return outfit.skin === 'default' ? (locale === 'ko' ? '기본' : 'Default') : outfit.skin;
  if (locale === 'en') return skin.en;
  return ('ko' in skin && skin.ko) || skin.art;
}
