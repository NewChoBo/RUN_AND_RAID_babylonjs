import { defineHero, type HeroCombat, type HeroEvents } from './hero-definition.ts';
import { chartStats } from '../../../content/raid/base-stats.ts';
import { RAID_HZ } from '../raid-rules.ts';
import type { SkillCast } from '../skills/skill-rule.ts';
import { raidRoadTravel } from '../runner-motion.ts';
import { shot } from './archive-skills.ts';
import { bolt } from '../skills/skill-effects.ts';

function basicInterval(base: number, stacks: number) {
  return Math.ceil(base / (1 + 0.3 * stacks));
}

class Vallet implements HeroEvents {
  readonly view = { escapeTicks: 0, firingStacks: 0 };
  private firingUntil = 0;
  private setStacks(c: HeroCombat, stacks: number) {
    if (stacks === this.view.firingStacks) return;
    const previous = basicInterval(c.stats.cooldown, this.view.firingStacks);
    const next = basicInterval(c.stats.cooldown, stacks);
    // Preserve the completed portion of the current basic attack's recovery.
    c.self.basic = Math.ceil((c.self.basic * next) / previous);
    this.view.firingStacks = stacks;
  }
  onCast(c: HeroCombat) {
    this.setStacks(c, Math.min(3, this.view.firingStacks + 1));
    this.firingUntil = c.tick() + 3 * RAID_HZ;
  }
  onBasicAttack(c: HeroCombat) {
    return {
      amount: c.stats.basicAttack,
      cooldown: basicInterval(c.stats.cooldown, this.view.firingStacks),
    };
  }
  onTimersAdvanced(c: HeroCombat) {
    if (this.view.firingStacks && c.tick() >= this.firingUntil) this.setStacks(c, 0);
  }
  onKnockout(c: HeroCombat) {
    this.setStacks(c, 0);
    this.firingUntil = this.view.escapeTicks = 0;
  }
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
