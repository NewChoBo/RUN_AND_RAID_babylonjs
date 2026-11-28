import { RAID_JUMP_TICKS } from '../runner-motion.ts';
import { grasp, stats } from '../../../content/raid/heroes/drizz.ts';
import { slow } from '../raid-control.ts';
import { projectile, sweep } from '../skills/skill-effects.ts';
import { defineHero, type HeroEvents } from './hero-definition.ts';

const darkHand: HeroEvents = {
  onOutgoingHit(combat, hit, victim) {
    return victim && combat.height(victim) > 0 ? Math.round(hit.amount * 1.1) : hit.amount;
  },
  resistsControl(runner) {
    return runner.dash?.skill === 3;
  },
};

export const drizz = defineHero(stats, () => darkHand, [
  projectile(grasp, { powerScale: 2, displacement: 'pull' }),
  sweep({ powerScale: 3, launchTicks: RAID_JUMP_TICKS }),
  {
    kind: 'pulse',
    requiresJump: true,
    attack: {
      kind: 'area',
      on: 'cast',
      area: { kind: 'circle', radius: 4.5 },
      hit: { powerScale: 3, control: [slow(30, 8)] },
    },
    apply(combat, cast) {
      combat.self.jumping = 0;
      combat.record(cast.skill, combat.self, 'ground');
    },
  },
  {
    kind: 'target',
    range: 12,
    attack: {
      kind: 'direct',
      on: 'dashEnd',
      contactRange: stats.reach,
      hit: { powerScale: 6, piercesShield: true },
    },
    apply(combat, cast) {
      combat.dash(cast.skill, cast.point, 6, cast.target);
    },
  },
]);
