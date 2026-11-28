import { chartStats } from '../../../content/raid/base-stats.ts';
import { silence, slow } from '../raid-control.ts';
import { distance, RAID_HZ } from '../raid-rules.ts';
import type { RaidPoint, RaidTarget } from '../raid-view.ts';
import { noAttack } from '../skills/attack-rule.ts';
import {
  defineHero,
  type Hit,
  type HeroCombat,
  type HofTurret,
  type TurretSlot,
} from './hero-definition.ts';

const ranges = [20, 16, 14] as const;
const periods = [15, 30, RAID_HZ] as const;
const hits = [
  { powerScale: 0.9 },
  { powerScale: 1.3, control: [slow(RAID_HZ, 15)] },
  { powerScale: 0.8 },
] as const;
interface Installation extends HofTurret {
  target?: RaidTarget;
  next: number;
  pulses: number;
}
class Workshop {
  readonly view = { turrets: [] as Installation[], blasts: [] as (RaidPoint & { tick: number })[] };
  private sequence = 0;
  private silencedAt = new Map<RaidTarget, number>();

  place(c: HeroCombat, slot: TurretSlot, point: RaidPoint) {
    this.view.turrets = this.view.turrets.filter((t) => t.slot !== slot);
    this.view.turrets.push({
      ...point,
      slot,
      id: ++this.sequence,
      placed: c.tick(),
      next: c.tick() + 36,
      pulses: 0,
    });
    c.record(slot, point, 'ground');
  }
  onBeforeHits(c: HeroCombat) {
    const tick = c.tick();
    this.view.blasts = this.view.blasts.filter((b) => tick - b.tick < 12);
    for (const t of this.view.turrets) {
      const pos = t;
      if (t.target !== undefined) {
        const tracked = c.position(t.target);
        if (!tracked || distance(pos, tracked) > ranges[t.slot]) {
          t.target = undefined;
          t.pulses = 0;
        }
      }
      if (tick < t.next) continue;
      // Acquire from the installation, even when its owner has moved past the target.
      const targets = c.enemies(pos, ranges[t.slot]);
      const target = targets.sort(
        (a, b) => distance(pos, c.position(a)!) - distance(pos, c.position(b)!),
      )[0];
      if (target === undefined) {
        t.target = undefined;
        t.pulses = 0;
        continue;
      }
      t.pulses = t.target === target ? t.pulses + 1 : 1;
      t.target = target;
      t.next = tick + periods[t.slot];
      const to = c.position(target)!;
      t.shot = { x: to.x, z: to.z, tick };
      c.strike(target, hits[t.slot], t.slot);
      if (
        t.slot === 2 &&
        t.pulses >= 3 &&
        tick - (this.silencedAt.get(target) ?? -Infinity) >= 3 * RAID_HZ
      ) {
        c.strike(target, { powerScale: 0.7, control: [silence(RAID_HZ)] }, 2);
        this.silencedAt.set(target, tick);
        t.pulses = 0;
      }
    }
  }
  detonate(c: HeroCombat) {
    const counts = new Map<RaidTarget, number>();
    for (const t of this.view.turrets) {
      const center = { x: t.x, z: t.z };
      this.view.blasts.push({ ...center, tick: c.tick() });
      for (const id of c.enemies(center, 6)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of counts) c.strike(id, { powerScale: 6 * (1 + 0.35 * (count - 1)) }, 3);
    this.view.turrets = [];
    for (const slot of [0, 1, 2] as const)
      c.self.cooldowns[slot] = Math.ceil(c.self.cooldowns[slot]! / 2);
    c.record(3, c.self);
  }
  onOutgoingHit(_c: HeroCombat, hit: Hit) {
    return hit.skill !== undefined && hit.target === 'wagon'
      ? Math.round(hit.amount / 2)
      : hit.amount;
  }
}
function turret(slot: TurretSlot) {
  return {
    kind: 'field' as const,
    range: 6,
    attack: { kind: 'none', area: { kind: 'circle', radius: ranges[slot] } } as const,
    apply: (c: HeroCombat, cast: { point: RaidPoint }, state: Workshop) =>
      state.place(c, slot, cast.point),
  };
}
export const hof = defineHero({ ...chartStats.hof, power: 10, radius: 4.2 }, () => new Workshop(), [
  turret(0),
  turret(1),
  turret(2),
  {
    kind: 'pulse',
    attack: noAttack,
    available: (r) => !!r.heroView.turrets?.length,
    apply: (c, _cast, state) => state.detonate(c),
  },
]);
