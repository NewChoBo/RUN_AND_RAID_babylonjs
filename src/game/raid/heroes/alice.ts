import { stats } from '../../../content/raid/heroes/alice.ts';
import { silence, slow } from '../raid-control.ts';
import { RAID_HZ } from '../raid-rules.ts';
import { defineHero, type HeroCombat, type HeroEvents } from './hero-definition.ts';

class Alice implements HeroEvents {
  get view() {
    return this;
  }
  orbTicks = 0;
  resistsControl() {
    return this.orbTicks > 0;
  }
  onTimersAdvanced(combat: HeroCombat) {
    if (this.orbTicks && --this.orbTicks % RAID_HZ === 0) {
      for (const enemy of combat.enemies(combat.self, 14))
        combat.strike(enemy, { powerScale: 1.4 }, 3);
      for (const ally of combat.allies(combat.self, 14)) combat.heal(ally, 12);
    }
    if (combat.tick() % (12 * RAID_HZ) === 0) {
      for (const ally of combat.allies(combat.self, 10)) {
        if (ally !== combat.self.slot) combat.heal(ally, 1);
      }
    }
  }
}
export const alice = defineHero(stats, () => new Alice(), [
  {
    kind: 'pulse',
    attack: {
      kind: 'area',
      on: 'cast',
      area: { kind: 'circle', radius: 6, belowHeight: 0.65 },
      hit: { powerScale: 2.5, displacement: 'push' },
    },
    apply(combat, cast) {
      combat.record(cast.skill, combat.self, 'ground');
    },
  },
  {
    kind: 'target',
    allowAlly: 'includingSelf',
    allyEffect: 'heal',
    range: 15,
    attack: { kind: 'direct', on: 'cast', hit: { powerScale: 2, control: [silence(15)] } },
    apply(combat, cast) {
      if (typeof cast.target === 'number' && !combat.position(cast.target)) {
        combat.heal(cast.target, Math.round(stats.power * 2.5));
        combat.self.lastWard = cast.target;
      }
      combat.record(cast.skill, cast.point);
    },
  },
  {
    kind: 'target',
    allowAlly: 'includingSelf',
    allyEffect: 'barrier',
    range: 15,
    attack: { kind: 'direct', on: 'cast', hit: { powerScale: 2.5, control: [slow(60, 20)] } },
    apply(combat, cast) {
      if (typeof cast.target === 'number' && !combat.position(cast.target)) {
        combat.barrier(cast.target, 2 * stats.power, 75);
        combat.self.lastWard = cast.target;
      }
      combat.record(cast.skill, cast.point);
    },
  },
  {
    kind: 'pulse',
    attack: { kind: 'none', area: { kind: 'circle', radius: 14 } },
    apply(combat, cast, state) {
      state.orbTicks = 5 * RAID_HZ;
      combat.record(cast.skill, combat.self, 'ground');
    },
  },
]);
