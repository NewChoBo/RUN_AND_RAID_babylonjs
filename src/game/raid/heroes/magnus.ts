import { chartStats } from '../../../content/raid/base-stats.ts';
import { defineHero, type HeroCombat, type HeroEvents, type Hit } from './hero-definition.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { RAID_HZ } from '../raid-rules.ts';

class Magnus implements HeroEvents {
  readonly view = { shieldMode: false };
  private readonly inactiveCooldowns = [0, 0, 0];
  changeMode(c: HeroCombat) {
    for (const slot of [0, 1, 2] as const) {
      const previous = c.self.cooldowns[slot]!;
      c.self.cooldowns[slot] = this.inactiveCooldowns[slot]!;
      this.inactiveCooldowns[slot] = previous;
    }
    this.view.shieldMode = !this.view.shieldMode;
  }
  onKnockout(c: HeroCombat) {
    if (this.view.shieldMode) this.changeMode(c);
    this.magnetUntil = this.rageUntil = 0;
    this.openingStrike = false;
  }
  resistsControl(r: HeroCombat['self']) {
    return this.view.shieldMode && r.dash?.skill === 0;
  }
  magnetUntil = 0;
  rageUntil = 0;
  openingStrike = false;
  onOutgoingHit(c: HeroCombat, hit: Hit) {
    const opening = this.openingStrike && hit.skill === undefined;
    if (opening) this.openingStrike = false;
    return Math.round(hit.amount * (this.rageUntil > c.tick() ? 1.3 : 1)) + (opening ? 10 : 0);
  }
  onTimersAdvanced(c: HeroCombat) {
    for (const slot of [0, 1, 2] as const)
      if (this.inactiveCooldowns[slot]!) this.inactiveCooldowns[slot]!--;
    if (this.magnetUntil >= c.tick() && (this.magnetUntil - c.tick()) % RAID_HZ === 0) {
      for (const id of c.enemies(c.self, 5)) c.strike(id, { powerScale: 1 }, 1);
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
  { ...chartStats.magnus, reach: chartStats.magnus.reach + 0.3, power: 10, radius: 4 },
  () => new Magnus(),
  [
    {
      kind: 'pulse',
      attack: {
        kind: 'none',
        area: { kind: 'circle', radius: (c) => (c.self.heroView.shieldMode ? 4 : 3) },
      },
      apply(c, cast, state) {
        if (state.view.shieldMode) {
          c.dash(cast.skill, { x: c.self.x, z: c.self.z + 5 }, 8);
          return;
        }
        for (const id of c.enemies(c.self, 3))
          c.strike(id, { powerScale: 3, displacement: 'push' }, cast.skill);
        c.record(cast.skill, c.self, 'ground');
      },
    },
    {
      kind: 'pulse',
      attack: {
        kind: 'none',
        area: { kind: 'circle', radius: (c) => (c.self.heroView.shieldMode ? 8 : 5) },
      },
      apply(c, cast, state) {
        if (state.view.shieldMode) {
          for (const id of c.enemies(c.self, 8))
            c.strike(id, { powerScale: 2, tauntTicks: RAID_HZ }, cast.skill);
        } else {
          c.barrier(c.self.slot, 24, 5 * RAID_HZ);
          state.magnetUntil = c.tick() + 5 * RAID_HZ;
        }
        c.record(cast.skill, c.self);
      },
    },
    {
      kind: 'pulse',
      attack: {
        kind: 'none',
        area: { kind: 'circle', radius: (c) => (c.self.heroView.shieldMode ? 8 : 0) },
      },
      apply(c, cast, state) {
        if (state.view.shieldMode)
          c.heal(c.self.slot, 12 + 8 * c.enemies(c.self, 8).filter((id) => id !== 'wagon').length);
        else state.rageUntil = c.tick() + 5 * RAID_HZ;
        c.record(cast.skill, c.self);
      },
    },
    {
      kind: 'pulse',
      attack: noAttack,
      noRageCost: true,
      cooldownTicks: 5.5 * RAID_HZ,
      apply(c, cast, state) {
        state.changeMode(c);
        state.openingStrike = !state.view.shieldMode;
        c.barrier(c.self.slot, 10, 2 * RAID_HZ);
        c.record(cast.skill, c.self);
      },
    },
  ],
);
