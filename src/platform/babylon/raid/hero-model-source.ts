import { battleOutfit } from '../../../content/raid/battle-outfits.ts';
import type { RaidHero } from '../../../game/raid/heroes/hero-id.ts';

const installed = import.meta.glob<{ file: string }>('../../../content/raid/ready-heroes/*.json', {
  eager: true,
  import: 'default',
});

/** Baked player models carry their authored materials and weapons. */
export function heroModelSource(hero: RaidHero, outfit?: string) {
  const original = battleOutfit(hero, outfit) ?? battleOutfit(hero, hero + '/default');
  const local = installed['../../../content/raid/ready-heroes/' + hero + '.json'];
  if (
    !original &&
    local &&
    new RegExp('^playable/' + hero + '-[a-f0-9]{16}\\.glb$').test(local.file)
  ) {
    return { url: './player-assets/' + local.file, authored: true, loop: 'run', clips: undefined };
  }
  if (original) {
    return {
      url: original.model,
      outfitId: original.id,
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
