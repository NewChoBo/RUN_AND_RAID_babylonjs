import { sacrificeRadius, stats } from '../../../content/raid/heroes/abyss.ts';
import { defineHero, type HeroCombat, type HeroEvents, type Hit } from './hero-definition.ts';
import { shot } from './archive-skills.ts';
import { type HitRule } from '../skills/attack-rule.ts';
import type { HeroSkill } from '../skills/skill-rule.ts';
import { slow, silence } from '../raid-control.ts';
import { distance, RAID_HZ } from '../raid-rules.ts';

class Abyss implements HeroEvents {
  hiddenUntil = 0;
  readonly depthPower: number;
  constructor(depthPower: number) {
    this.depthPower = depthPower;
  }
  onOutgoingHit(c: HeroCombat, hit: Hit) {
    if (c.self.hero !== 'abyss' || c.self.respawn || hit.skill === undefined) return hit.amount;
    const target = c.position(hit.target);
    return target && distance(c.self, target) <= sacrificeRadius ? hit.amount * 1.25 : hit.amount;
  }
  onIncomingHit(c: HeroCombat) {
    return c.tick() < this.hiddenUntil;
  }
  onBeforeHits(c: HeroCombat) {
    const left = this.hiddenUntil - c.tick();
    if (this.hiddenUntil && left >= 0 && left % (RAID_HZ / 2) === 0)
      for (const id of c.enemies(c.self, 4)) c.strike(id, { powerScale: this.depthPower }, 2);
  }
}

function vortex(
  range: number,
  radius: number,
  count: number,
  hit: HitRule,
): HeroSkill<Abyss, 'field'> {
  return {
    kind: 'field',
    range,
    attack: {
      kind: 'field',
      area: { kind: 'circle', radius },
      pulse: {
        count,
        intervalTicks: RAID_HZ,
        effect: { kind: 'damageEnemies', hit, pullToCenter: true },
      },
    },
    apply(c, cast) {
      c.record(cast.skill, cast.point, 'ground');
    },
  };
}

function defineAbyss(power: { orb: number; depths: number; voidOrb: number }) {
  return defineHero(stats, () => new Abyss(power.depths), [
    shot({ powerScale: power.orb, control: [silence(RAID_HZ)] }, [0], false, 11),
    vortex(15, 6, 1, { powerScale: 3, control: [slow(2 * RAID_HZ, 20)] }),
    {
      kind: 'pulse',
      attack: { kind: 'none', area: { kind: 'circle', radius: 4 } },
      apply(c, cast, state) {
        state.hiddenUntil = c.tick() + 2 * RAID_HZ;
        c.record(cast.skill, c.self, 'ground');
      },
    },
    vortex(12, 10, 4, { powerScale: power.voidOrb }),
  ]);
}

export const abyss = defineAbyss({ orb: 2.4, depths: 1.2, voidOrb: 2.4 });
export const archiveAbyss = defineAbyss({ orb: 3, depths: 1.5, voidOrb: 2.5 });
