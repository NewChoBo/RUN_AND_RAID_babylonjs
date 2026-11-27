import { grasp, stats } from '../../../content/raid/heroes/drizz.ts';
import { silence, slow, stagger } from '../raid-control.ts';
import { projectile, sweep } from '../skills/skill-effects.ts';
import { defineHero, type HeroEvents } from './hero-definition.ts';

const darkHand: HeroEvents = {
  onOutgoingHit(combat, hit, victim) {
    return victim && combat.height(victim) > 0 ? Math.round(hit.amount * 1.2) : hit.amount;
  },
  resistsControl(runner) {
    return runner.dash?.skill === 3;
  },
};

export const drizz = defineHero(stats, () => darkHand, [
  projectile(grasp, { powerScale: 2, control: [silence(24)], displacement: 'pull' }),
  sweep({ powerScale: 3, control: [stagger(18)], displacement: 'launch' }),
  {
    kind: 'pulse',
    requiresJump: true,
    attack: {
      kind: 'area',
      on: 'cast',
      area: { kind: 'circle', radius: 4.5 },
      hit: { powerScale: 3, control: [slow(45)] },
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
