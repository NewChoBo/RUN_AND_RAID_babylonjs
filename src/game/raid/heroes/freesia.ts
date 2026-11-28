import { defineHero, type HeroCombat, type HeroEvents } from './hero-definition.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { RAID_HZ } from '../raid-rules.ts';
import type { SkillCast } from '../skills/skill-rule.ts';
import { RAID_REAR_Z, raidGroundPointAfter } from '../runner-motion.ts';
import { slow } from '../raid-control.ts';
import type { RaidPoint } from '../raid-view.ts';
import { field, bolt } from '../skills/skill-effects.ts';

class Freesia implements HeroEvents {
  readonly view = { concealedUntil: 0 };
  decoy?: RaidPoint & { tick: number };
  traps: (RaidPoint & { tick: number })[] = [];
  onBeforeHits(c: HeroCombat) {
    if (this.decoy && c.tick() - this.decoy.tick >= 2 * RAID_HZ) {
      const point = raidGroundPointAfter(this.decoy, 2 * RAID_HZ);
      for (const id of c.enemies(point, 3)) c.strike(id, { powerScale: 3 }, 2);
      this.decoy = undefined;
    }
    this.traps = this.traps.filter((trap) => {
      const point = raidGroundPointAfter(trap, c.tick() - trap.tick);
      const targets = c.enemies(point, 5);
      if (!targets.length) return point.z + 5 >= RAID_REAR_Z;
      for (const id of targets)
        c.strike(id, { powerScale: 5, control: [slow(3 * RAID_HZ, 30)] }, 3);
      return false;
    });
  }
}
export const freesia = defineHero(
  { hp: 96, basicAttack: 10, power: 10, reach: 8, cooldown: 22, radius: 4 },
  () => new Freesia(),
  [
    {
      ...field(
        { powerScale: 2 },
        { count: 3, intervalTicks: RAID_HZ, effect: { kind: 'healAllies', powerScale: 1 } },
        { kind: 'circle', radius: 6 },
      ),
      apply(c: HeroCombat, cast: SkillCast<'field'>) {
        c.placeField(0, cast.point, 6, {
          count: 3,
          intervalTicks: RAID_HZ,
          effect: { kind: 'damageEnemies', hit: { powerScale: 1 } },
        });
        c.record(cast.skill, cast.point, 'ground');
      },
    },
    {
      ...bolt({ powerScale: 2, blindTicks: 75 }, { range: 15 }),
      allowAlly: 'includingSelf',
      allyEffect: 'barrier',
      apply(c: HeroCombat, cast: SkillCast<'target'>) {
        if (typeof cast.target === 'number' && c.ally(cast.target)) {
          c.barrier(cast.target, 12, 75);
          c.guardControl(cast.target, 75);
        }
        c.record(cast.skill, cast.point);
      },
    },
    {
      kind: 'pulse',
      attack: noAttack,
      apply(c, cast, state) {
        state.decoy = { x: c.self.x, z: c.self.z, tick: c.tick() };
        state.view.concealedUntil = c.tick() + 2 * RAID_HZ;
        c.record(cast.skill, c.self, 'ground');
      },
    },
    {
      kind: 'field',
      range: 15,
      attack: { kind: 'none', area: { kind: 'circle', radius: 5 } },
      apply(c, cast, state) {
        state.traps.push({ ...cast.point, tick: c.tick() });
        c.record(cast.skill, cast.point, 'ground');
      },
    },
  ],
);
