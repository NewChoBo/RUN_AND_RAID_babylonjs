import { RAID_HZ } from '../raid-rules.ts';
import { chartStats } from '../../../content/raid/base-stats.ts';
import { defineHero, type HeroCombat, type HeroEvents, type Hit } from './hero-definition.ts';
import { bolt, field, sweep } from '../skills/skill-effects.ts';
import { silence, slow, stagger, stun } from '../raid-control.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { aid, barrage, rush, shot } from './archive-skills.ts';

class Frostbite implements HeroEvents {
  private recharge = 3 * RAID_HZ;
  readonly view = { iceCrystals: 5, guardUntil: 0 };
  readonly chilledUntil = new Map<number | 'wagon', number>();
  onCast(_c: HeroCombat, skill: number) {
    if (skill < 3) this.view.iceCrystals -= skill === 1 ? 2 : 1;
  }
  private rechargeBy(ticks: number) {
    this.recharge -= ticks;
    if (this.recharge <= 0) {
      this.view.iceCrystals = Math.min(5, this.view.iceCrystals + 1);
      this.recharge += 3 * RAID_HZ;
    }
  }
  onTimersAdvanced() {
    this.rechargeBy(1);
  }
  onIncomingHit(c: HeroCombat, hit: Hit) {
    if (this.view.guardUntil <= c.tick() || hit.skill === undefined || hit.rule?.piercesShield)
      return false;
    this.view.guardUntil = 0;
    return true;
  }
  onOutgoingHit(c: HeroCombat, hit: Hit) {
    const chilled = (this.chilledUntil.get(hit.target) ?? 0) > c.tick();
    if (hit.skill === undefined && chilled) this.rechargeBy(RAID_HZ);
    if (hit.skill !== undefined && hit.skill !== 1)
      this.chilledUntil.set(hit.target, c.tick() + 4 * RAID_HZ);
    return chilled ? Math.round(hit.amount * 1.25) : hit.amount;
  }
}
export const froze = defineHero(
  { ...chartStats.froze, power: 10, reach: 3.4, radius: 6 },
  () => new Frostbite(),
  [
    {
      ...shot({ powerScale: 3, control: [slow(30, 6)] }, [0], true),
      cooldownTicks: 15,
      available: (r) => (r.heroView.iceCrystals ?? 0) >= 1,
    },
    {
      kind: 'pulse',
      attack: noAttack,
      cooldownTicks: 25,
      available: (r) => (r.heroView.iceCrystals ?? 0) >= 2,
      apply(c, cast, state) {
        for (const id of c.enemies(c.self, 6))
          if ((state.chilledUntil.get(id) ?? 0) > c.tick())
            c.strike(id, { powerScale: 4, control: [slow(30, 15)] }, cast.skill);
        c.record(cast.skill, c.self, 'ground');
      },
    },
    {
      kind: 'pulse',
      attack: noAttack,
      available: (r) => (r.heroView.iceCrystals ?? 0) >= 1,
      apply(c, cast, state) {
        state.view.guardUntil = c.tick() + 2 * RAID_HZ;
        c.record(cast.skill, c.self);
      },
    },
    // Fifteen ticks stunned, then sixty ticks of slowed movement.
    sweep({ powerScale: 3, control: [stun(15), slow(60, 40, 15)] }, { kind: 'circle', radius: 12 }),
  ],
);
export const theresa = defineHero(
  { ...chartStats.theresa, power: 10, reach: 3.5, radius: 3.6 },
  () => ({}),
  [
    aid(28, 0, 7),
    bolt({ powerScale: 3, control: [stun(Math.ceil(0.75 * RAID_HZ))] }, { range: 8 }),
    sweep({ powerScale: 3, launchTicks: RAID_HZ }),
    barrage({ powerScale: 3 }, { powerScale: 2 }, 2, 15),
  ],
);
export const hof = defineHero({ ...chartStats.hof, power: 10, reach: 8, radius: 4.2 }, () => ({}), [
  barrage({ powerScale: 1 }, { powerScale: 1, control: [slow(30, 15)] }, 4, 8),
  rush({ powerScale: 3, displacement: 'push' }, 9),
  field({ powerScale: 4, control: [stagger(12)] }),
  shot({ powerScale: 3 }, [-0.15, 0, 0.15], true, 19),
]);
export const vallet = defineHero(
  { ...chartStats.vallet, power: 10, reach: 10, radius: 3.8 },
  () => ({}),
  [
    shot({ powerScale: 2 }, [-0.075, 0.075]),
    rush({ powerScale: 2 }, 6),
    barrage({ powerScale: 2 }, { powerScale: 1 }, 3, 9),
    shot({ powerScale: 6, piercesShield: true }, [0], true, 20),
  ],
);
export const freesia = defineHero(
  { hp: 96, basicAttack: 10, power: 10, reach: 8, cooldown: 22, radius: 4 },
  () => ({}),
  [
    shot({ powerScale: 2, control: [slow(48)] }, [-0.1, 0.1]),
    aid(20, 12),
    field(
      { powerScale: 2 },
      { count: 3, intervalTicks: 12, effect: { kind: 'healAllies', powerScale: 1 } },
    ),
    bolt({ powerScale: 6, control: [silence(32)] }),
  ],
);
