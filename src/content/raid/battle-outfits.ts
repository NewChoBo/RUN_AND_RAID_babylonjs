import published from './published-outfits.json' with { type: 'json' };
import type { RaidHero } from '../../game/raid/heroes/hero-id.ts';

export const battleOutfits = published.map((outfit) => ({
  ...outfit,
  id: outfit.group + '/' + outfit.skin,
}));
const byId = new Map(battleOutfits.map((o) => [o.id, o]));

/** Room packets carry a catalog ID. Model URLs always come from the shipped manifest. */
export function battleOutfit(hero: RaidHero, id: unknown) {
  const outfit = typeof id === 'string' ? byId.get(id) : undefined;
  return outfit && (outfit.group === hero || outfit.group === 'base') ? outfit : undefined;
}
