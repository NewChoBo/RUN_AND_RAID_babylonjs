import { RAID_HZ, WAGON } from './raid-rules.ts';
import type { RaidPoint } from './raid-view.ts';

// The rear and front wheels extend beyond the bed. Coordinates are horizontal road metres.
export const WAGON_BODY = { halfWidth: 1.8, halfDepth: 1.92 } as const;
const centerZ = WAGON.z + 1;
// Restoration timing: alternate short straight runs with a drift of one tenth of the road width.
const laneOffsets = [0, 0, 1.8, 1.8, -1.8, -1.8, 0] as const;
const legTicks = 3 * RAID_HZ;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

/** The match clock drives simulation, replay and fractional render frames along the same path. */
export function wagonCenter(tick: number): RaidPoint {
  const phase = (Math.max(0, tick) / legTicks) % (laneOffsets.length - 1);
  const leg = Math.floor(phase);
  const t = phase - leg;
  const blend = t * t * (3 - 2 * t);
  return { x: laneOffsets[leg]! + (laneOffsets[leg + 1]! - laneOffsets[leg]!) * blend, z: centerZ };
}

export function wagonContact(from: RaidPoint, tick: number): RaidPoint {
  const center = wagonCenter(tick);
  return {
    x: clamp(from.x, center.x - WAGON_BODY.halfWidth, center.x + WAGON_BODY.halfWidth),
    z: clamp(from.z, center.z - WAGON_BODY.halfDepth, center.z + WAGON_BODY.halfDepth),
  };
}

/** Nearest point on the hull inside a forward-facing sector (half-angle up to 90 degrees). */
export function wagonSectorContact(
  from: RaidPoint,
  tick: number,
  halfAngle: number,
): RaidPoint | null {
  const point = wagonContact(from, tick);
  const lateral = Math.abs(point.x - from.x);
  const dz = lateral === 0 ? 0 : lateral / Math.tan(halfAngle);
  const z = Math.max(point.z, from.z + dz);
  const front = centerZ + WAGON_BODY.halfDepth;
  return z <= front + 1e-9 ? { x: point.x, z: Math.min(z, front) } : null;
}

// Intersect a swept interval with a stationary slab on one separating axis.
function overlap(
  times: { enter: number; exit: number },
  start: number,
  delta: number,
  half: number,
) {
  if (delta === 0) return Math.abs(start) <= half;
  const a = (-half - start) / delta;
  const b = (half - start) / delta;
  times.enter = Math.max(times.enter, Math.min(a, b));
  times.exit = Math.min(times.exit, Math.max(a, b));
  return times.enter <= times.exit;
}

/** First contact with the body during a segment. Padding is a radius with rounded corners. */
export function wagonSegmentContact(
  from: RaidPoint,
  to: RaidPoint,
  tick: number,
  padding = 0,
  previousTick = tick,
): number | null {
  const start = wagonCenter(previousTick);
  const x = from.x - start.x,
    z = from.z - centerZ;
  const dx = to.x - wagonCenter(tick).x - x,
    dz = to.z - from.z;
  const { halfWidth, halfDepth } = WAGON_BODY;
  const times = { enter: 0, exit: 1 };
  if (!overlap(times, x, dx, halfWidth + padding) || !overlap(times, z, dz, halfDepth + padding))
    return null;
  if (!padding) return times.enter;
  const ex = x + dx * times.enter,
    ez = z + dz * times.enter;
  const cx = clamp(ex, -halfWidth, halfWidth),
    cz = clamp(ez, -halfDepth, halfDepth);
  if (Math.hypot(ex - cx, ez - cz) <= padding) return times.enter;
  // The expanded box was entered through a corner. Intersect its circular cap.
  const ox = x - cx,
    oz = z - cz;
  const a = dx * dx + dz * dz,
    b = ox * dx + oz * dz;
  const c = ox * ox + oz * oz - padding * padding;
  const discriminant = b * b - a * c;
  if (a === 0 || b >= 0 || discriminant < 0) return null;
  const t = c / (-b + Math.sqrt(discriminant));
  return t >= 0 && t <= times.exit ? t : null;
}

/** Sweep the projectile's transverse edge against the translating body over one tick. */
export function wagonProjectileContact(
  from: RaidPoint,
  to: RaidPoint,
  tick: number,
  dx: number,
  dz: number,
  halfWidth: number,
): number | null {
  if (!halfWidth) return wagonSegmentContact(from, to, tick, 0, tick - 1);
  const x = from.x - wagonCenter(tick - 1).x,
    z = from.z - centerZ;
  const vx = to.x - wagonCenter(tick).x - x,
    vz = to.z - from.z;
  const times = { enter: 0, exit: 1 };
  // The rectangle contributes two axis normals and the transverse edge contributes the heading.
  if (
    !overlap(times, x, vx, WAGON_BODY.halfWidth + halfWidth * Math.abs(dz)) ||
    !overlap(times, z, vz, WAGON_BODY.halfDepth + halfWidth * Math.abs(dx)) ||
    !overlap(
      times,
      x * dx + z * dz,
      vx * dx + vz * dz,
      WAGON_BODY.halfWidth * Math.abs(dx) + WAGON_BODY.halfDepth * Math.abs(dz),
    )
  )
    return null;
  return times.enter;
}
