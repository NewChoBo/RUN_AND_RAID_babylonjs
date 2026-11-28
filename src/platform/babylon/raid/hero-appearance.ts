import type { HeroKit } from '../../../game/raid/heroes/hero-id.ts';
import type { Skill } from '../../../game/raid/raid-view.ts';

/** Scale of runner models and body markings relative to the course. Attack footprints use world metres. */
export const RAID_RUNNER_SCALE = 0.75;
// Shared visual multiplier applied to the model rig after its base scale.
export const RAID_MODEL_SCALE = 1.6;
export const RAID_RIG_SCALE = 0.8 * RAID_MODEL_SCALE;

export interface HeroAppearance {
  cape: string;
  sprite: string;
  equipment?: 'warhammer' | 'staff' | 'rapier' | 'saber' | 'quiver' | 'shieldBlade' | 'crystal';
  barHeight?: number;
  empoweredMesh?: string;
  spinClip?: 'field' | 'fury';
  dashClip?: 'field' | 'fury';
  dashTrail?: 'shadowBlades';
  landingChop?: boolean;
  particles?: 'spiral' | 'vortex' | 'arrows' | 'heavy';
  projectile?: Partial<
    Record<
      Skill,
      'horizontal' | 'upright' | 'cross' | 'arrow' | 'orb' | 'fireball' | 'pellet' | 'slug' | 'hand'
    >
  >;
}
// Model attachments and particle styles belong to the renderer. Combat never reads this table.
export const appearance: Record<HeroKit, HeroAppearance> = {
  flare: {
    cape: '#ff7544',
    sprite: 'scorch_01',
    particles: 'vortex',
    projectile: { 0: 'fireball' },
  },
  hof: { cape: '#e9bf63', sprite: 'scorch_01', particles: 'heavy' },
  froze: { cape: '#69d8fb', sprite: 'twirl_01', particles: 'spiral' },
  magnus: { cape: '#eab251', sprite: 'scorch_01', particles: 'heavy' },
  theresa: { cape: '#f0d168', sprite: 'spark_05', particles: 'heavy' },
  vallet: {
    cape: '#ea9a8c',
    sprite: 'spark_05',
    particles: 'arrows',
    projectile: { 1: 'pellet', 3: 'slug' },
  },
  freesia: { cape: '#98efbc', sprite: 'magic_01', particles: 'spiral' },
  drizz: {
    cape: '#75394e',
    sprite: 'scorch_01',
    dashClip: 'fury',
    particles: 'heavy',
    projectile: { 0: 'hand', 3: 'hand' },
  },
  alice: { cape: '#f0cb8b', sprite: 'magic_01', particles: 'spiral' },
  kali: { cape: '#713594', sprite: 'twirl_01', dashClip: 'fury', dashTrail: 'shadowBlades' },
  rildin: { cape: '#a12f29', sprite: 'spark_05', empoweredMesh: '2H_Sword' },
  kaiken: {
    cape: '#cfcedc',
    sprite: 'twirl_01',
    equipment: 'saber',
    spinClip: 'fury',
    dashClip: 'field',
    projectile: { 0: 'horizontal', 1: 'upright' },
  },
  swift: { cape: '#18525d', sprite: 'spark_05', equipment: 'rapier', projectile: { 0: 'cross' } },
  hammer: {
    cape: '#a64028',
    sprite: 'scorch_01',
    equipment: 'warhammer',
    spinClip: 'field',
    landingChop: true,
    particles: 'heavy',
  },
  abyss: {
    cape: '#693bad',
    sprite: 'twirl_01',
    barHeight: 2.48,
    particles: 'vortex',
    projectile: { 0: 'orb' },
  },
  longshot: {
    cape: '#a57629',
    sprite: 'spark_05',
    equipment: 'quiver',
    particles: 'arrows',
    projectile: { 0: 'arrow', 3: 'arrow' },
  },
  jade: { cape: '#168768', sprite: 'magic_01', equipment: 'staff', particles: 'spiral' },
  rend: { cape: '#912f29', sprite: 'scorch_01' },
  bastion: { cape: '#395878', sprite: 'spark_05', equipment: 'shieldBlade' },
  rime: { cape: '#43829a', sprite: 'twirl_01', equipment: 'crystal' },
};
