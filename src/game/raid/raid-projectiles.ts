import type { ProjectileAttack, HitRule } from './skills/attack-rule.ts';
import type { RaidHero } from './heroes/hero-id.ts';
import type { RaidPoint, RaidRunner, RaidTarget, Skill } from './raid-view.ts';

export interface RaidDirection {
  dx: number;
  dz: number;
}
export function unitDirection(dx: number, dz: number): RaidDirection | null {
  const length = Math.hypot(dx, dz);
  return Number.isFinite(length) && length > 0.000001 ? { dx: dx / length, dz: dz / length } : null;
}

interface Projectile extends RaidPoint, RaidDirection {
  readonly caster: number;
  readonly hero: RaidHero;
  readonly skill: Skill;
  readonly metersPerTick: number;
  readonly attack: ProjectileAttack;
  remaining: number;
  // Piercing shots remember targets already passed. Most volleys share their hit set.
  readonly hit: Set<RaidTarget>;
  readonly volleyTargets?: Set<RaidTarget>;
}
export type RaidProjectile = Readonly<Omit<Projectile, 'hit' | 'volleyTargets'>>;

// Entry time in [0, 1] into a moving ellipse, measured along this tick's shot segment.
function contact(x: number, z: number, dx: number, dz: number, rx: number, rz: number) {
  x /= rx;
  z /= rz;
  dx /= rx;
  dz /= rz;
  const c = x * x + z * z - 1;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz,
    b = x * dx + z * dz;
  const discriminant = b * b - a * c;
  if (a === 0 || b >= 0 || discriminant < 0) return Infinity;
  const t = c / (-b + Math.sqrt(discriminant));
  return t <= 1 ? t : Infinity;
}

/** Fixed directions and reach in wagon-relative metres. Only contact during flight deals damage. */
export class RaidProjectiles {
  #active: Projectile[] = [];
  readonly #ended: RaidProjectile[] = [];
  get active(): readonly RaidProjectile[] {
    return this.#active;
  }
  get ended(): readonly RaidProjectile[] {
    return this.#ended;
  }
  beginTick() {
    this.#ended.length = 0;
  }
  launch(
    r: RaidRunner,
    skill: Skill,
    direction: RaidDirection,
    attack: ProjectileAttack,
    hz: number,
  ) {
    const profile = attack.flight;
    const heading = Math.atan2(direction.dx, direction.dz);
    const hit = new Set<RaidTarget>();
    const volleyTargets = profile.repeatHitScale === undefined ? undefined : new Set<RaidTarget>();
    for (const angle of profile.angles) {
      this.#active.push({
        volleyTargets,
        x: r.x,
        z: r.z,
        dx: Math.sin(heading + angle),
        dz: Math.cos(heading + angle),
        caster: r.slot,
        hero: r.hero,
        skill,
        remaining: profile.reach,
        metersPerTick: profile.speed / hz,
        attack,
        hit: profile.hitPerArrow ? new Set<RaidTarget>() : hit,
      });
    }
  }
  step(
    runners: readonly RaidRunner[],
    previous: readonly (RaidPoint & { height: number })[],
    wagon: RaidPoint,
    height: (runner: RaidRunner) => number,
    strike: (caster: number, target: RaidTarget, skill: Skill, hit: HitRule) => void,
  ) {
    this.#active = this.#active.filter((p) => {
      const step = Math.min(p.remaining, p.metersPerTick);
      const dx = p.dx * step,
        dz = p.dz * step;
      const contacts: { t: number; target: RaidTarget }[] = [];
      // The carriage body extends from the rear standard to the front crown.
      const wagonTime = contact(p.x - wagon.x, p.z - wagon.z - 1, dx, dz, 1.8, 1.9);
      if (Number.isFinite(wagonTime)) contacts.push({ t: wagonTime, target: 'wagon' });
      for (const r of runners) {
        if (r.respawn || r.team === runners[p.caster]!.team) continue;
        const old = previous[r.slot]!;
        // Rotate into shot space so a broad horizontal blade has the same sweep in every direction.
        const x = p.x - old.x,
          z = p.z - old.z;
        const vx = dx - (r.x - old.x),
          vz = dz - (r.z - old.z);
        const t = contact(
          x * p.dz - z * p.dx,
          x * p.dx + z * p.dz,
          vx * p.dz - vz * p.dx,
          vx * p.dx + vz * p.dz,
          p.attack.flight.contact.halfWidth,
          p.attack.flight.contact.halfDepth,
        );
        if (
          Number.isFinite(t) &&
          (p.attack.flight.contact.maxHeight === undefined ||
            old.height + (height(r) - old.height) * t <= p.attack.flight.contact.maxHeight)
        )
          contacts.push({ t, target: r.slot });
      }
      for (const { target, t } of contacts.sort((a, b) => a.t - b.t)) {
        if (!p.hit.has(target)) {
          const flight = p.attack.flight;
          const scale = p.volleyTargets?.has(target)
            ? flight.repeatHitScale!
            : flight.pierceScale === undefined
              ? 1
              : flight.pierceScale ** p.hit.size;
          p.hit.add(target);
          p.volleyTargets?.add(target);
          const hit =
            scale === 1
              ? p.attack.hit
              : { ...p.attack.hit, powerScale: p.attack.hit.powerScale * scale };
          strike(p.caster, target, p.skill, hit);
          if (p.attack.splashRadius) {
            const x = p.x + dx * t,
              z = p.z + dz * t;
            for (const other of runners) {
              if (other.slot === target || other.team === runners[p.caster]!.team || other.respawn)
                continue;
              const old = previous[other.slot]!;
              const ox = old.x + (other.x - old.x) * t,
                oz = old.z + (other.z - old.z) * t;
              if (Math.hypot(ox - x, oz - z) <= p.attack.splashRadius)
                strike(p.caster, other.slot, p.skill, p.attack.hit);
            }
            if (target !== 'wagon' && Math.hypot(wagon.x - x, wagon.z - z) <= p.attack.splashRadius)
              strike(p.caster, 'wagon', p.skill, p.attack.hit);
          }
        }
        if (!p.attack.flight.pierces) {
          p.x += dx * t;
          p.z += dz * t;
          p.remaining = 0;
          this.#ended.push(p);
          return false;
        }
      }
      p.x += dx;
      p.z += dz;
      p.remaining -= step;
      if (p.remaining === 0) this.#ended.push(p);
      return p.remaining > 0;
    });
  }
}
