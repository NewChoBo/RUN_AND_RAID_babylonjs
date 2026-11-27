import { standardContact } from '../../../content/raid/projectile-contact.ts';
import { projectile, field } from '../skills/skill-effects.ts';
import type { HitRule } from '../skills/attack-rule.ts';
import { noAttack } from '../skills/attack-rule.ts';
import type { HeroSkill } from '../skills/skill-rule.ts';

// Curated flight patterns use the same collision profile for player aim, bots and impact.
export function shot(hit: HitRule, angles: readonly number[] = [0], pierces = false, reach = 16) {
  return projectile({ reach, speed: 24, angles, pierces, contact: standardContact }, hit);
}
export function rush(
  hit: HitRule,
  range: number,
  halfWidth = 1.2,
): HeroSkill<unknown, 'direction'> {
  return { kind: 'direction', range, travelTicks: 8, attack: { kind: 'dashPath', halfWidth, hit } };
}
export function barrage(impact: HitRule, pulse: HitRule, count: number, intervalTicks = 12) {
  return field(impact, { count, intervalTicks, effect: { kind: 'damageEnemies', hit: pulse } });
}
export function aid(healing: number, protection: number, range = 12): HeroSkill<unknown, 'ward'> {
  return {
    kind: 'ward',
    range,
    attack: noAttack,
    apply(c, cast) {
      if (healing) c.heal(cast.target, healing);
      if (protection) c.barrier(cast.target, protection, 75);
      c.self.lastWard = cast.target;
      c.record(cast.skill, cast.point);
    },
  };
}
