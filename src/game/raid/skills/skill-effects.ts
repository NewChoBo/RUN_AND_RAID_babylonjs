import { RAID_SKILL_RANGE } from '../raid-rules.ts';
import type { HeroCombat } from '../heroes/hero-definition.ts';
import type { HeroSkill, SkillCast } from './skill-rule.ts';
import { casterCircle, fieldCircle, type CircleArea } from './attack-area.ts';
import type {
  AreaHit,
  AreaAttack,
  FieldPulse,
  HitRule,
  ProjectileAttack,
  ProjectileProfile,
} from './attack-rule.ts';

export function sweep(hit: HitRule, area: CircleArea = casterCircle): HeroSkill<unknown, 'pulse'> {
  return {
    kind: 'pulse',
    attack: { kind: 'area', on: 'cast', area, hit },
    apply(combat, cast) {
      combat.record(cast.skill, combat.self, 'ground');
    },
  };
}
export function field(
  hit: HitRule = { powerScale: 3 },
  pulse?: FieldPulse,
  area: CircleArea = fieldCircle,
): HeroSkill<unknown, 'field'> {
  return {
    kind: 'field',
    range: RAID_SKILL_RANGE.field,
    attack: { kind: 'field', area, hit, pulse },
    apply(combat, cast) {
      combat.record(cast.skill, cast.point, 'ground');
    },
  };
}
export function bolt(
  hit: HitRule,
  options: {
    range?: number;
    splash?: AreaHit;
    onCast?: (combat: HeroCombat, cast: SkillCast<'target'>) => void;
  } = {},
): HeroSkill<unknown, 'target'> {
  return {
    kind: 'target',
    range: options.range ?? RAID_SKILL_RANGE.shot,
    attack: { kind: 'direct', on: 'cast', hit, splash: options.splash },
    apply(combat, cast) {
      combat.record(cast.skill, cast.point);
      options.onCast?.(combat, cast);
    },
  };
}
export function projectile(
  flight: ProjectileProfile,
  hit: HitRule,
  windupTicks?: number,
): Extract<HeroSkill<unknown, 'direction'>, { attack: ProjectileAttack }> {
  return { kind: 'direction', attack: { kind: 'projectile', flight, hit, windupTicks } };
}
export function spin(
  ticks: number,
  attack: AreaAttack<'spinPulse'>,
  options?: { cancelOnRetap: true },
): HeroSkill<unknown, 'pulse'> {
  return {
    kind: 'pulse',
    attack,
    apply(combat, cast) {
      const cue = combat.record(cast.skill, combat.self);
      combat.self.spin = {
        skill: cast.skill,
        remaining: ticks,
        duration: ticks,
        interval: 15,
        radius: cast.radius,
        cancelCue: options?.cancelOnRetap ? cue : undefined,
      };
      if (combat.controlImmune()) combat.self.slows.length = 0;
    },
  };
}
