import type { RaidHero } from '../../../game/raid/heroes/hero-id.ts';

const installed = import.meta.glob<{ file: string }>('../../../content/raid/ready-heroes/*.json', {
  eager: true,
  import: 'default',
});

/** Baked player models carry their authored materials and weapons. */
export function heroModelSource(hero: RaidHero) {
  const local = installed['../../../content/raid/ready-heroes/' + hero + '.json'];
  if (local && new RegExp('^playable/' + hero + '-[a-f0-9]{16}\\.glb$').test(local.file)) {
    return { url: './player-assets/' + local.file, authored: true };
  }
  return { url: './assets/raid/' + hero + '.glb', authored: false };
}
