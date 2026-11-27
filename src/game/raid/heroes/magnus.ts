import { defineHero, type HeroCombat, type HeroEvents, type Hit } from './hero-definition.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { RAID_HZ } from '../raid-rules.ts';

class Magnus implements HeroEvents {
  readonly view = { shieldMode: false };
  magnetUntil = 0;
  rageUntil = 0;
  openingStrike = false;
  onOutgoingHit(c: HeroCombat, hit: Hit) {
    const opening = this.openingStrike && hit.skill === undefined;
    if (opening) this.openingStrike = false;
    return Math.round(hit.amount * (this.rageUntil > c.tick() ? 1.3 : 1)) + (opening ? 10 : 0);
  }
  onTimersAdvanced(c: HeroCombat) {
    if (this.magnetUntil >= c.tick() && (this.magnetUntil - c.tick()) % RAID_HZ === 0) {
      for (const id of c.enemies(c.self, 4)) c.strike(id, { powerScale: 1 }, 1);
    }
  }
  onIncomingDamage(amount: number) {
    return this.view.shieldMode ? Math.round(amount * 0.8) : amount;
  }
  onDashEnd(c: HeroCombat) {
    for (const id of c.enemies(c.self, 4)) c.strike(id, { powerScale: 3, displacement: 'push' }, 0);
  }
}
export const magnus = defineHero(
  { hp: 149, power: 10, reach: 3.2, cooldown: 25, radius: 4 },
  () => new Magnus(),
  [
    {
      kind: 'pulse',
      attack: noAttack,
      apply(c, cast, state) {
        if (state.view.shieldMode) {
          c.dash(cast.skill, { x: c.self.x, z: c.self.z + 5 }, 8);
          return;
        }
        for (const id of c.enemies(c.self, 4.5))
          c.strike(id, { powerScale: 3, displacement: 'launch' }, cast.skill);
        c.record(cast.skill, c.self, 'ground');
      },
    },
    {
      kind: 'pulse',
      attack: noAttack,
      apply(c, cast, state) {
        if (state.view.shieldMode) {
          for (const id of c.enemies(c.self, 4))
            c.strike(id, { powerScale: 2, tauntTicks: 36 }, cast.skill);
        } else {
          c.barrier(c.self.slot, 24, 5 * RAID_HZ);
          state.magnetUntil = c.tick() + 5 * RAID_HZ;
        }
        c.record(cast.skill, c.self);
      },
    },
    {
      kind: 'pulse',
      attack: noAttack,
      apply(c, cast, state) {
        if (state.view.shieldMode)
          c.heal(c.self.slot, 12 + 8 * c.enemies(c.self, 5).filter((id) => id !== 'wagon').length);
        else state.rageUntil = c.tick() + 5 * RAID_HZ;
        c.record(cast.skill, c.self);
      },
    },
    {
      kind: 'pulse',
      attack: noAttack,
      noRageCost: true,
      cooldownTicks: 4 * RAID_HZ,
      apply(c, cast, state) {
        state.view.shieldMode = !state.view.shieldMode;
        state.openingStrike = !state.view.shieldMode;
        c.barrier(c.self.slot, 10, 2 * RAID_HZ);
        c.record(cast.skill, c.self);
      },
    },
  ],
);
