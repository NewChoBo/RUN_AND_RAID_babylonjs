import { defineHero, type HeroCombat, type HeroEvents, type Hit } from './hero-definition.ts';
import { noAttack } from '../skills/attack-rule.ts';
import { chartStats } from '../../../content/raid/base-stats.ts';
import { RAID_HZ } from '../raid-rules.ts';
import { slow, stun } from '../raid-control.ts';
import { bolt, sweep } from '../skills/skill-effects.ts';

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
  { ...chartStats.froze, power: 10, radius: 6 },
  () => new Frostbite(),
  [
    {
      ...bolt({ powerScale: 3, control: [slow(30, 6)] }, { range: 12 }),
      cooldownTicks: 15,
      available: (r) => (r.heroView.iceCrystals ?? 0) >= 1,
    },
    {
      kind: 'target',
      range: 13,
      allowAlly: true,
      attack: noAttack,
      cooldownTicks: 25,
      available: (r) => (r.heroView.iceCrystals ?? 0) >= 2,
      apply(c, cast, state) {
        c.record(cast.skill, cast.point);
        const facing = c.facing(cast.target);
        c.blink({
          x: cast.point.x - 0.85 * Math.sin(facing),
          z: cast.point.z - 0.85 * Math.cos(facing),
        });
        if ((state.chilledUntil.get(cast.target) ?? 0) > c.tick())
          c.strike(cast.target, { powerScale: 4, control: [slow(RAID_HZ, 15)] }, cast.skill, true);
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
