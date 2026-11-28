import { leapImpactRadius, stats } from '../../../content/raid/heroes/hammer.ts';
import { defineHero } from './hero-definition.ts';
import { bolt, spin, sweep } from '../skills/skill-effects.ts';
import type { HeroEvents } from './hero-definition.ts';
import { casterCircle } from '../skills/attack-area.ts';
import type { AreaAttack } from '../skills/attack-rule.ts';
import { slow, stun } from '../raid-control.ts';
const landing = {
  kind: 'area',
  on: 'land',
  area: { kind: 'circle', radius: leapImpactRadius },
  hit: { powerScale: 2, launchTicks: 30 },
} as const satisfies AreaAttack;
const whirlwind = {
  kind: 'area',
  on: 'spinPulse',
  area: casterCircle,
  hit: { powerScale: 1.5 },
} as const satisfies AreaAttack;
const hammerEvents: HeroEvents = {
  resistsControl(runner) {
    return runner.spinTicks > 0;
  },
};
export const hammer = defineHero(stats, () => hammerEvents, [
  sweep({ powerScale: 3, control: [slow(30, 10)] }),
  {
    kind: 'leap',
    range: 13,
    attack: landing,
    apply(combat, cast) {
      combat.self.leap = {
        skill: cast.skill,
        from: { x: combat.self.x, z: combat.self.z },
        to: { x: cast.point.x, z: cast.point.z },
        elapsed: 0,
      };
    },
  },
  spin(60, whirlwind, { cancelOnRetap: true }),
  bolt(
    { powerScale: 7, control: [stun(45)] },
    { range: 10, splash: { area: { kind: 'circle', radius: 6 }, hit: { powerScale: 3.5 } } },
  ),
]);
