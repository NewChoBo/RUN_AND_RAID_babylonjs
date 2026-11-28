import {
  stats,
  crossSlash,
  lungeTicks,
  daggerReleaseTicks,
  daggerSpeed,
} from '../../../content/raid/heroes/swift.ts';
import { defineHero } from './hero-definition.ts';

import { projectile } from '../skills/skill-effects.ts';
import type { HeroCombat, HeroEvents, Hit } from './hero-definition.ts';
import type { RaidPoint, RaidTarget, Skill } from '../raid-view.ts';
import { distance, RAID_HZ } from '../raid-rules.ts';
import { unitDirection } from '../raid-projectiles.ts';
import { actionLocked, slow } from '../raid-control.ts';
import { noAttack } from '../skills/attack-rule.ts';
import type { DirectAttack, DashStrike } from '../skills/attack-rule.ts';
const lunge = {
  kind: 'direct',
  on: 'dashEnd',
  contactRange: stats.reach,
  hit: { powerScale: 3 },
} as const satisfies DashStrike;
const execution = {
  kind: 'direct',
  on: 'cast',
  hit: { powerScale: 7, control: [slow(30, 50)] },
} as const satisfies DirectAttack;

export interface TrackingDagger extends RaidPoint {
  target: RaidTarget;
  height: number;
  releaseTick: number;
}

class Swift implements HeroEvents {
  readonly view = {
    quarry: null as RaidTarget | null,
    guardUntil: 0,
    trackingDagger: null as TrackingDagger | null,
  };
  private quarryUntil = 0;
  private vengeance = 0;
  aimDagger(c: HeroCombat, target: RaidTarget) {
    this.view.trackingDagger = {
      x: c.self.x,
      z: c.self.z,
      height: c.height(c.self) + 1.2,
      target,
      releaseTick: c.tick() + daggerReleaseTicks,
    };
  }
  onCast(c: HeroCombat, skill: Skill) {
    if (skill !== 2 && this.view.trackingDagger && c.tick() < this.view.trackingDagger.releaseTick)
      this.view.trackingDagger = null;
  }
  onBeforeHits(c: HeroCombat) {
    const dagger = this.view.trackingDagger;
    if (!dagger) return;
    const point = c.position(dagger.target);
    if (!point || (c.tick() <= dagger.releaseTick && actionLocked(c.self))) {
      this.view.trackingDagger = null;
      return;
    }
    if (c.tick() <= dagger.releaseTick) {
      dagger.x = c.self.x;
      dagger.z = c.self.z;
      dagger.height = c.height(c.self) + 1.2;
      return;
    }
    const dx = point.x - dagger.x,
      dz = point.z - dagger.z;
    const dy = ('jumping' in point ? c.height(point) + 1 : 1.8) - dagger.height;
    const gap = Math.hypot(dx, dy, dz);
    const step = daggerSpeed / RAID_HZ;
    if (gap <= step) {
      c.strike(dagger.target, { powerScale: 1 }, 2, true);
      this.view.trackingDagger = null;
      return;
    }
    const fraction = step / gap;
    dagger.x += dx * fraction;
    dagger.z += dz * fraction;
    dagger.height += dy * fraction;
  }
  onBasicAttack(combat: HeroCombat) {
    this.vengeance += 4 * Math.floor((10 * (stats.hp - combat.self.hp)) / stats.hp);
    let amount = stats.basicAttack;
    if (this.vengeance >= 100) {
      amount *= 2;
      this.vengeance -= 100;
    }
    const target = this.view.quarry !== null && combat.position(this.view.quarry);
    const haste =
      target && this.quarryUntil > combat.tick()
        ? Math.max(0, 1.05 - 0.105 * Math.max(0, distance(combat.self, target) - 1))
        : 0;
    return { amount, cooldown: Math.ceil(stats.cooldown / (1 + haste)) };
  }
  onIncomingHit(combat: HeroCombat) {
    return this.view.guardUntil > combat.tick();
  }
  onOutgoingHit(combat: HeroCombat, hit: Hit) {
    if (!combat.self.respawn && hit.skill === 2) {
      this.view.quarry = hit.target;
      this.quarryUntil = combat.tick() + 5 * RAID_HZ;
    }
    return hit.amount;
  }
  onTickEnd(combat: HeroCombat) {
    if (this.view.trackingDagger && !combat.position(this.view.trackingDagger.target))
      this.view.trackingDagger = null;
    if (
      this.view.quarry !== null &&
      (this.quarryUntil <= combat.tick() || !combat.position(this.view.quarry))
    )
      this.view.quarry = null;
  }
}
export const swift = defineHero(stats, () => new Swift(), [
  projectile(crossSlash, { powerScale: 2, control: [slow(30, 20)] }),
  {
    kind: 'target',
    range: 12,
    attack: lunge,
    apply(combat, cast) {
      const point = cast.point;
      const d = unitDirection(point.x - combat.self.x, point.z - combat.self.z);
      const gap = Math.min(distance(combat.self, point), 0.85);
      combat.dash(
        1,
        { x: point.x - (d?.dx ?? 0) * gap, z: point.z - (d?.dz ?? 1) * gap },
        lungeTicks,
        cast.target,
      );
    },
  },
  {
    kind: 'target',
    range: 12,
    attack: noAttack,
    apply(c, cast, state) {
      if (c.self.hero === 'swift') state.aimDagger(c, cast.target);
      else c.strike(cast.target, { powerScale: 1 }, cast.skill, true);
      c.record(cast.skill, cast.point);
    },
  },
  {
    kind: 'target',
    range: 8,
    attack: execution,
    apply(combat, cast, state) {
      combat.record(3, cast.point);
      combat.blink({ x: cast.point.x, z: cast.point.z - 1.1 });
      state.view.guardUntil = combat.tick() + 8;
    },
  },
]);
