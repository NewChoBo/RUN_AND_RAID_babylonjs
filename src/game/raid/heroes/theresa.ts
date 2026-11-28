import { defineHero, type HeroCombat, type HeroEvents } from './hero-definition.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { chartStats } from '../../../content/raid/base-stats.ts';
import { distance, RAID_HZ } from '../raid-rules.ts';
import { stun } from '../raid-control.ts';
import { sweep } from '../skills/skill-effects.ts';
import { raidRoadTravel } from '../runner-motion.ts';

class Theresa implements HeroEvents {
  auraTicks = 0;
  onBeforeHits(c: HeroCombat) {
    if (this.auraTicks && --this.auraTicks % RAID_HZ === 0) {
      for (const ally of c.allies(c.self, 6))
        if (ally !== c.self.slot) c.heal(ally, c.stats.power, 'aura');
      for (const enemy of c.enemies(c.self, 6)) c.strike(enemy, { powerScale: 1.5 }, 3);
    }
  }
}
export const theresa = defineHero(
  { ...chartStats.theresa, power: 10, reach: 3.5, radius: 3.6 },
  () => new Theresa(),
  [
    {
      kind: 'pulse',
      attack: noAttack,
      apply(c, cast) {
        for (const ally of c.allies(c.self, 6)) c.heal(ally, ally === c.self.slot ? 28 : 14);
        c.record(cast.skill, c.self, 'ground');
      },
    },
    {
      kind: 'target',
      range: 5,
      attack: {
        kind: 'direct',
        on: 'dashEnd',
        contactRange: 2.2,
        hit: { powerScale: 3, control: [stun(Math.ceil(0.75 * RAID_HZ))] },
      },
      apply(c, cast) {
        const gap = distance(c.self, cast.point);
        const ticks = Math.max(1, Math.ceil((14 * gap) / 5));
        const travel = Math.max(0, gap - 0.65) / Math.max(gap, 0.001);
        c.dash(
          1,
          {
            x: c.self.x + (cast.point.x - c.self.x) * travel,
            z: c.self.z + (cast.point.z - c.self.z) * travel + raidRoadTravel(ticks),
          },
          ticks,
          cast.target,
        );
      },
    },
    sweep({ powerScale: 3, launchTicks: RAID_HZ }),
    {
      kind: 'pulse',
      attack: noAttack,
      apply(c, cast, state) {
        state.auraTicks = 5 * RAID_HZ;
        c.record(cast.skill, c.self, 'ground');
      },
    },
  ],
);
