import { RAID_ROAD_WIDTH, ROUND_TICKS, WAGON } from './raid-rules.ts';
import { RAID_FRONT_Z, RAID_REAR_Z, raidRoadTravel } from './runner-motion.ts';
import type { RaidPoint, RaidRunner } from './raid-view.ts';

const columns = 5;
export const RAID_ELECTRIC_GRID = {
  columns,
  width: RAID_ROAD_WIDTH / columns,
  depth: RAID_ROAD_WIDTH / columns,
} as const;
export const RAID_COUNTERS = {
  low: { windup: 30, active: 7, damage: 20 },
  pillar: { windup: 42, active: 9, damage: 26 },
} as const;
const firstWarningTick = 60;
const attackInterval = 144;
const ticksPerRow = 6;
const jumpClearance = 0.6;
// Over four pillar attacks both sides receive a two-cell and a three-cell bank.
const pillarBanks = [
  { firstColumn: 0, span: 3 },
  { firstColumn: columns - 2, span: 2 },
  { firstColumn: 0, span: 2 },
  { firstColumn: columns - 3, span: 3 },
] as const;

export interface RaidCounterCell extends Readonly<RaidPoint> {
  readonly column: number;
  readonly row: number;
  readonly phase: 'warning' | 'impact';
  readonly ticks: number;
}
export interface RaidCounter {
  readonly startedAt: number;
  readonly kind: keyof typeof RAID_COUNTERS;
  readonly zigzag: boolean;
  readonly cells: readonly RaidCounterCell[];
}

export function raidElectricRowZ(row: number, tick: number) {
  return WAGON.z + row * RAID_ELECTRIC_GRID.depth - raidRoadTravel(tick);
}
export function raidElectricColumnX(column: number) {
  return (column - (columns - 1) / 2) * RAID_ELECTRIC_GRID.width;
}

export function inElectricCell(cell: RaidPoint, point: RaidPoint) {
  const dx = point.x - cell.x;
  const dz = point.z - cell.z;
  const halfX = RAID_ELECTRIC_GRID.width / 2;
  const halfZ = RAID_ELECTRIC_GRID.depth / 2;
  return dx >= -halfX && dx < halfX && dz >= -halfZ && dz < halfZ;
}

interface Discharge {
  startedAt: number;
  kind: RaidCounter['kind'];
  zigzag: boolean;
  span: number;
  path: { firstColumn: number; row: number; warningAt: number }[];
}

function planDischarge(tick: number, turn: number, targetX: number): Discharge {
  const kind = turn % 2 === 0 ? 'low' : 'pillar';
  const zigzag = tick >= ROUND_TICKS / 2;
  const { width, depth } = RAID_ELECTRIC_GRID;
  const bank = pillarBanks[Math.floor(turn / 2) % pillarBanks.length]!;
  const span = kind === 'low' ? 1 : bank.span;
  const targetColumn = Math.floor((targetX + RAID_ROAD_WIDTH / 2) / width);
  // Pillar banks alternate flanks. The open side can be read from the first row.
  let firstColumn =
    kind === 'pillar' ? bank.firstColumn : Math.min(columns - 1, Math.max(0, targetColumn));
  let direction = turn % 4 < 2 ? 1 : -1;
  // The leading charged tile meets the front runners after its warning has scrolled with the road.
  const firstImpact = tick + RAID_COUNTERS[kind].windup;
  let row = Math.round((RAID_FRONT_Z - WAGON.z + raidRoadTravel(firstImpact)) / depth);
  const path: Discharge['path'] = [];
  for (
    let warningAt = tick;
    raidElectricRowZ(row, warningAt + RAID_COUNTERS[kind].windup) >= RAID_REAR_Z - depth / 2;
    warningAt += ticksPerRow
  ) {
    path.push({ firstColumn, row, warningAt });
    row--;
    if (zigzag) {
      if (firstColumn + direction < 0 || firstColumn + direction + span > columns) direction *= -1;
      firstColumn += direction;
    }
  }
  return { startedAt: tick, kind, zigzag, span, path };
}

export class RaidBoss {
  #discharge: Discharge | null = null;
  #counter: RaidCounter | null = null;
  readonly #struck = new Set<number>();

  get counter() {
    return this.#counter;
  }

  step(
    tick: number,
    runners: readonly RaidRunner[],
    height: (r: RaidRunner) => number,
    hit: (slot: number, damage: number) => void,
  ) {
    if (tick >= firstWarningTick && (tick - firstWarningTick) % attackInterval === 0) {
      const turn = (tick - firstWarningTick) / attackInterval;
      const alive = runners.filter((r) => !r.respawn);
      if (alive.length) {
        const volley = Math.floor(turn / 2);
        const target =
          alive.find((r) => r.slot === volley % runners.length) ?? alive[volley % alive.length]!;
        this.#discharge = planDischarge(tick, turn, target.x);
        this.#struck.clear();
      }
    }
    if (!this.#discharge) return;
    const { startedAt, kind, zigzag, span, path } = this.#discharge;
    const { windup, active, damage } = RAID_COUNTERS[kind];
    const cells: RaidCounterCell[] = [];
    for (const { firstColumn, row, warningAt } of path) {
      const age = tick - warningAt;
      if (age < 0) break;
      if (age >= windup + active) continue;
      const warning = age < windup;
      const phase = warning ? 'warning' : 'impact';
      const ticks = (warning ? windup : windup + active) - age;
      const z = raidElectricRowZ(row, tick);
      for (let column = firstColumn; column < firstColumn + span; column++) {
        cells.push({ column, row, x: raidElectricColumnX(column), z, phase, ticks });
      }
    }
    if (!cells.length) {
      this.#counter = null;
      this.#discharge = null;
      return;
    }
    this.#counter = { startedAt, kind, zigzag, cells };
    for (const r of runners) {
      if (r.respawn || this.#struck.has(r.slot) || (kind === 'low' && height(r) >= jumpClearance))
        continue;
      if (cells.some((cell) => cell.phase === 'impact' && inElectricCell(cell, r))) {
        this.#struck.add(r.slot);
        hit(r.slot, damage);
      }
    }
  }
}
