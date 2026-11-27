import { raidOutfits } from '../../../content/raid/outfits.ts';
import { battleOutfits } from '../../../content/raid/battle-outfits.ts';
import type { RaidHero } from '../../../game/raid/heroes/hero-id.ts';

const installed = import.meta.glob<{ file: string }>('../../../content/raid/ready-heroes/*.json', {
  eager: true,
  import: 'default',
});

/** Baked player models carry their authored materials and weapons. */
export function heroModelSource(hero: RaidHero, outfit?: string) {
  const local = installed['../../../content/raid/ready-heroes/' + hero + '.json'];
  if (
    !outfit &&
    local &&
    new RegExp('^playable/' + hero + '-[a-f0-9]{16}\\.glb$').test(local.file)
  ) {
    return { url: './player-assets/' + local.file, authored: true, loop: 'run', clips: undefined };
  }
  const original = outfit
    ? (battleOutfits.find((o) => o.model === outfit) ?? raidOutfits.find((o) => o.model === outfit))
    : raidOutfits.find((o) => o.group === hero && o.skin === 'default');
  if (original) {
    return {
      url: original.model,
      authored: true,
      loop: original.clips?.includes('run')
        ? 'run'
        : original.group === 'demonslayer' && original.clips?.includes('Animation')
          ? 'Animation'
          : undefined,
      clips: original.clips,
    };
  }
  return { url: './assets/raid/' + hero + '.glb', authored: false, loop: 'run', clips: undefined };
}
