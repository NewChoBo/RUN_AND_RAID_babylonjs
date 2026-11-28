import { chartStats } from '../../../content/raid/base-stats.ts';
import { slow, stun } from '../raid-control.ts';
import { RAID_HZ } from '../raid-rules.ts';
import type { RaidTarget } from '../raid-view.ts';
import { noAttack } from '../skills/attack-rule.ts';
import type { SkillCast } from '../skills/skill-rule.ts';
import { field, sweep } from '../skills/skill-effects.ts';
import { shot } from './archive-skills.ts';
import { defineHero, type HeroCombat, type HeroEvents, type Hit } from './hero-definition.ts';

class Ignition implements HeroEvents {
  readonly view = { burns: [] as { target: RaidTarget; next: number; remaining: number }[] };
  guardTicks = 0;
  ignite(target: RaidTarget, tick: number) {
    const burns = this.view.burns.filter((b) => b.target !== target);
    this.view.burns = [...burns, { target, next: tick + RAID_HZ, remaining: 4 }];
  }
  onOutgoingHit(_combat: HeroCombat, hit: Hit) {
    if (hit.skill !== undefined && hit.skill !== 2) {
      const burn = this.view.burns.find((b) => b.target === hit.target);
      if (burn) burn.remaining++;
    }
    return hit.amount;
  }
  resistsControl() {
    return this.guardTicks > 0;
  }
  onTickEnd() {
    if (this.guardTicks) this.guardTicks--;
  }
  onTimersAdvanced(c: HeroCombat) {
    if (!this.view.burns.length) return;
    this.view.burns = this.view.burns.filter((burn) => {
      if (!c.position(burn.target)) return false;
      if (c.tick() >= burn.next) {
        c.strike(burn.target, { powerScale: 1 }, 2);
        burn.next += RAID_HZ;
        burn.remaining--;
      }
      return burn.remaining > 0;
    });
  }
}

const fireball = shot({ powerScale: 3, control: [slow(45, 15)] }, [0], false, 20);
const burst = sweep({ powerScale: 3 }, { kind: 'circle', radius: 6 });
export const flare = defineHero(
  { ...chartStats.flare, power: 10, reach: 9, radius: 4 },
  () => new Ignition(),
  [
    { ...fireball, attack: { ...fireball.attack, splashRadius: 3 } },
    {
      ...burst,
      apply(c: HeroCombat, cast: SkillCast<'pulse'>, state: Ignition) {
        state.guardTicks = RAID_HZ / 2;
        c.record(cast.skill, c.self, 'ground');
      },
    },
    {
      kind: 'target',
      range: 10,
      attack: noAttack,
      apply(c, cast, state) {
        state.ignite(cast.target, c.tick());
        c.self.lastStrike = cast.target;
        c.record(cast.skill, cast.point);
      },
    },
    field({ powerScale: 6, control: [stun(45)] }, undefined, { kind: 'circle', radius: 10 }),
  ],
);
