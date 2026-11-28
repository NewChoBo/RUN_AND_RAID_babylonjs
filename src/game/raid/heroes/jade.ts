import { slow } from '../raid-control.ts';
import { stats } from '../../../content/raid/heroes/jade.ts';
import { defineHero, type CombatRead } from './hero-definition.ts';
import { distance, RAID_HZ } from '../raid-rules.ts';
import { noAttack } from '../skills/attack-rule.ts';
import type { RaidPoint, RaidTarget } from '../raid-view.ts';

const carrier = (c: CombatRead) => c.ally(c.self.lastWard ?? c.self.slot) ?? c.self;
const point = ({ x, z }: RaidPoint) => ({ x, z });
const discharge = { kind: 'circle', radius: 6 } as const;
const nova = { kind: 'circle', radius: 1.2 } as const;

export const jade = defineHero(stats, () => ({}), [
  {
    kind: 'ward',
    attack: noAttack,
    range: 15,
    apply(c, cast) {
      c.barrier(cast.target, Math.round(130 / 3), 75);
      c.self.lastWard = cast.target;
      c.record(cast.skill, cast.point);
    },
  },
  {
    kind: 'pulse',
    origin: carrier,
    attack: {
      kind: 'area',
      on: 'cast',
      area: discharge,
      hit: {
        powerScale: 4,
        control: [slow(RAID_HZ, 20)],
      },
    },
    apply(c, cast) {
      c.haste(carrier(c).slot, RAID_HZ);
      c.record(cast.skill, cast.point, 'ground');
    },
  },
  {
    kind: 'pulse',
    origin: carrier,
    attack: noAttack,
    apply(c, cast) {
      let current: RaidTarget = carrier(c).slot;
      let from = cast.point;
      const visited = new Set<RaidTarget>([current]);
      const lines = [];
      for (let hop = 0; hop < 4; hop++) {
        const candidates = [
          ...c.enemies(from, 7).map((id) => ({ id, enemy: true, pos: c.position(id)! })),
          ...c.allies(from, 7).map((id) => ({ id, enemy: false, pos: c.ally(id)! })),
        ].filter((candidate) => candidate.id !== current);
        candidates.sort(
          (a, b) =>
            Number(visited.has(a.id)) - Number(visited.has(b.id)) ||
            Number(b.enemy) - Number(a.enemy) ||
            distance(from, a.pos) - distance(from, b.pos),
        );
        const next = candidates[0];
        if (!next) break;
        lines.push({ from: point(from), to: point(next.pos) });
        if (next.enemy) c.strike(next.id, { powerScale: visited.has(next.id) ? 2 : 4 }, cast.skill);
        visited.add(next.id);
        current = next.id;
        from = next.pos;
      }
      c.record(cast.skill, cast.point, 'ground', { lines });
    },
  },
  {
    kind: 'pulse',
    origin: carrier,
    attack: { kind: 'area', on: 'cast', area: nova, hit: { powerScale: 5 } },
    apply(c, cast) {
      const origin = cast.point,
        heading = c.facing(carrier(c).slot);
      const length = 8,
        hitTargets = new Set<RaidTarget>(),
        lines = [];
      for (let i = 0; i < 5; i++) {
        const angle = heading + (i * 2 * Math.PI) / 5;
        const dx = Math.sin(angle),
          dz = Math.cos(angle);
        lines.push({
          from: point(origin),
          to: { x: origin.x + dx * length, z: origin.z + dz * length },
        });
        for (const id of c.enemies(origin, length + 0.6)) {
          const target = c.position(id)!;
          const x = target.x - origin.x,
            z = target.z - origin.z;
          const along = dx * x + dz * z;
          // The wagon has a body. A ray can cross its hull while missing its centre.
          const width = id === 'wagon' ? 1.8 : 0.6;
          if (along < 0 || along > length || Math.abs(x * dz - z * dx) > width) continue;
          c.strike(id, { powerScale: hitTargets.has(id) ? 2.1 : 6 }, cast.skill);
          hitTargets.add(id);
        }
      }
      c.record(cast.skill, origin, 'ground', { lines });
    },
  },
]);
