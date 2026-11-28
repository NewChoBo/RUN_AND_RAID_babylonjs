import { defineHero, type HeroCombat, type HeroEvents } from './hero-definition.ts';
import { chartStats } from '../../../content/raid/base-stats.ts';
import { RAID_HZ } from '../raid-rules.ts';
import type { SkillCast } from '../skills/skill-rule.ts';
import { raidRoadTravel } from '../runner-motion.ts';
import { shot } from './archive-skills.ts';
import { bolt } from '../skills/skill-effects.ts';

class Vallet implements HeroEvents {
  readonly view = { escapeTicks: 0 };
  land(c: HeroCombat) {
    this.view.escapeTicks = 0;
    if (!c.self.launchDuration) c.self.jumping = 0;
    c.record(2, c.self, 'ground');
    for (const enemy of c.enemies(c.self, 4)) c.strike(enemy, { powerScale: 3 }, 2);
  }
  onBeforeHits(c: HeroCombat) {
    if (this.view.escapeTicks && --this.view.escapeTicks === 0) this.land(c);
  }
}
const scatter = shot({ powerScale: 2 }, [-0.28, 0, 0.28], false, 6);
export const vallet = defineHero(
  { ...chartStats.vallet, power: 10, radius: 3.8 },
  () => new Vallet(),
  [
    bolt({ powerScale: 2 }, { range: 10 }),
    {
      ...scatter,
      apply(c: HeroCombat, cast: SkillCast<'direction'>) {
        c.dash(
          1,
          {
            x: c.self.x - 2 * cast.direction.dx,
            z: c.self.z - 2 * cast.direction.dz + raidRoadTravel(6),
          },
          6,
        );
      },
    },
    {
      kind: 'pulse',
      attack: { kind: 'none', area: { kind: 'circle', radius: 4 } },
      apply(c, cast, state) {
        if (state.view.escapeTicks) {
          state.land(c);
          return;
        }
        state.view.escapeTicks = c.self.jumping = 2 * RAID_HZ;
        c.record(cast.skill, c.self);
      },
    },
    shot({ powerScale: 6, piercesShield: true }, [0], true, 20),
  ],
);
