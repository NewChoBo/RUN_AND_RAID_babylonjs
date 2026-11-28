import { RAID_JUMP_TICKS } from '../runner-motion.ts';
import { grasp, stats } from '../../../content/raid/heroes/drizz.ts';
import { actionLocked, slow } from '../raid-control.ts';
import { distance } from '../raid-rules.ts';
import { shot } from './archive-skills.ts';
import { projectile, sweep } from '../skills/skill-effects.ts';
import { defineHero, type HeroEvents } from './hero-definition.ts';

const darkHand: HeroEvents = {
  onProjectileContact(c, target, skill) {
    if (skill !== 3) return false;
    const point = c.position(target);
    if (point && !c.self.respawn && !c.self.dash && !c.self.leap && !actionLocked(c.self))
      c.dash(skill, point, 6, target);
    return true;
  },
  onDashEnd(c, target) {
    if (target === undefined) return;
    const point = c.position(target);
    if (point && distance(c.self, point) <= stats.reach)
      c.strike(target, { powerScale: 6, piercesShield: true }, 3);
  },
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
  shot({ powerScale: 6 }, [0], false, 15),
]);
