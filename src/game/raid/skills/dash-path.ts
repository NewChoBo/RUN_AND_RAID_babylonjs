import { RAID_TARGETS } from '../raid-rules.ts';
import type { RaidPoint, RaidTarget, Skill } from '../raid-view.ts';
import type { HeroCombat } from '../heroes/hero-definition.ts';
import type { DashPathAttack } from './attack-rule.ts';
import { wagonSegmentContact } from '../wagon.ts';

// Closest approach in the moving target's frame, including both endpoints of this tick.
export function strikeAlongDash(
  combat: HeroCombat,
  skill: Skill,
  attack: DashPathAttack,
  struck: RaidTarget[],
  previous: readonly RaidPoint[],
) {
  const caster = combat.self;
  const start = previous[caster.slot]!;
  for (const id of RAID_TARGETS) {
    if (struck.includes(id)) continue;
    if (id === 'wagon') {
      if (
        wagonSegmentContact(start, caster, combat.tick(), attack.halfWidth, combat.tick() - 1) ===
        null
      )
        continue;
    } else {
      const target = combat.position(id);
      if (!target) continue;
      const old = previous[id]!;
      const x = start.x - old.x,
        z = start.z - old.z;
      const dx = caster.x - target.x - x,
        dz = caster.z - target.z - z;
      const length2 = dx * dx + dz * dz;
      const fraction = length2 ? Math.max(0, Math.min(1, -(x * dx + z * dz) / length2)) : 0;
      if (Math.hypot(x + dx * fraction, z + dz * fraction) > attack.halfWidth) continue;
    }
    struck.push(id);
    combat.strike(id, attack.hit, skill);
  }
}
