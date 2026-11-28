import type { RaidDirection } from '../raid-projectiles.ts';
import type { RaidTarget } from '../raid-view.ts';
import type { SkillInfo, ResolvedCast } from './skill-rule.ts';
import type { SkillInput, TargetRead } from './skill-targeting.ts';

/** Per-life input history. Impacts, auto-attacks and lock changes never write here. */
export class LastAim {
  private enemy?: RaidTarget;
  private ally?: number;
  private selected?: RaidTarget;
  private track?: RaidTarget;
  private bearing?: RaidDirection;
  private offsetLength?: number;

  remember(c: TargetRead, kind: SkillInfo['kind'], cast: ResolvedCast) {
    if (kind === 'pulse') return;
    this.track = cast.target;
    if (cast.target !== undefined) {
      this.selected = cast.target;
      if (typeof cast.target === 'number' && c.ally(cast.target)) this.ally = cast.target;
      else this.enemy = cast.target;
    }
    const dx = cast.point.x - c.self.x;
    const dz = cast.point.z - c.self.z;
    const distance = Math.hypot(dx, dz);
    this.bearing =
      cast.direction ?? (distance ? { dx: dx / distance, dz: dz / distance } : undefined);
    this.offsetLength = cast.direction ? undefined : distance;
  }

  forgetTarget(slot: number) {
    if (this.selected === slot) this.selected = undefined;
    if (this.track === slot) this.track = undefined;
    if (this.ally === slot) this.ally = undefined;
    if (this.enemy === slot) this.enemy = undefined;
  }

  input(c: TargetRead, rule: SkillInfo, range: number): SkillInput | undefined {
    if (rule.kind === 'ward') return this.ally;
    if (rule.kind === 'target') return rule.allowAlly ? this.selected : this.enemy;
    if (rule.kind === 'pulse') return undefined;
    let bearing = this.bearing,
      length = this.offsetLength ?? range;
    if (
      this.track !== undefined &&
      (c.canTarget(this.track) ||
        (typeof this.track === 'number' && c.canShield(this.track, Infinity)))
    ) {
      const point = c.targetPoint(this.track)!;
      const dx = point.x - c.self.x,
        dz = point.z - c.self.z;
      length = Math.hypot(dx, dz);
      if (length) bearing = { dx: dx / length, dz: dz / length };
    }
    if (rule.kind === 'direction') return bearing;
    if (!length) return { x: c.self.x, z: c.self.z };
    if (!bearing) return undefined;
    length = Math.min(length, range);
    return { x: c.self.x + bearing.dx * length, z: c.self.z + bearing.dz * length };
  }
}
