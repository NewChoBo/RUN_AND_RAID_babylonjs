import { activeSlow } from './raid-control.ts';
import { airHeightAfter, RAID_JUMP_TICKS } from './air-movement.ts';
export { RAID_JUMP_TICKS } from './air-movement.ts';
import type { RaidRunner, RaidPoint } from './raid-view.ts';
import { RAID_HZ, RAID_LEAP_TICKS, RAID_RUN_LIMIT_X, WAGON } from './raid-rules.ts';
/** Distance in metres travelled by the wagon over this many match ticks (including sub-ticks). */
export const raidRoadTravel = (ticks: number) => (ticks * 6) / RAID_HZ;
/** A stationary patch of road, expressed in the wagon's frame at cast time and again after age ticks. */
export function raidGroundPointAfter(point: Readonly<RaidPoint>, age: number): RaidPoint {
  return { x: point.x, z: point.z - raidRoadTravel(age) };
}
export const raidLeapHeight = (fraction: number) => 2.2 * 4 * fraction * (1 - fraction);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
// Metres per second relative to the wagon, from a free run to full braking.
const RUN_SPEED = 2.8;
const BRAKE_SPEED = -4.2;
const forwardSpeed = (brake: number) => RUN_SPEED + (BRAKE_SPEED - RUN_SPEED) * brake;
// Full braking takes 0.30 s. Returning to a free run takes 0.40 s.
function brakeTransitionTicks(r: RaidRunner) {
  return (r.brake >= r.appliedBrake ? 0.3 : 0.4) * RAID_HZ;
}
export function raidBrakeAfter(r: RaidRunner, ticks: number) {
  const step = ticks / brakeTransitionTicks(r);
  return r.appliedBrake + clamp(r.brake - r.appliedBrake, -step, step);
}
function forwardTravel(r: RaidRunner, ticks: number) {
  const rampTicks = Math.min(ticks, Math.abs(r.brake - r.appliedBrake) * brakeTransitionTicks(r));
  const meanSpeed = forwardSpeed((r.appliedBrake + raidBrakeAfter(r, rampTicks)) / 2);
  return (meanSpeed * rampTicks + forwardSpeed(r.brake) * (ticks - rampTicks)) / RAID_HZ;
}
// Wagon-relative rear boundary estimated from the distant chase frames in docs/CAMERA.md.
export const RAID_REAR_Z = WAGON.z - 56;
export const RAID_FRONT_Z = WAGON.z - 1.6;

/** A picked road tile or instantaneous placement, in the current wagon frame. */
export function limitRaidPlacement(point: RaidPoint, travelTicks = 0): RaidPoint {
  const z = clamp(point.z, RAID_REAR_Z + raidRoadTravel(travelTicks), RAID_FRONT_Z);
  return z === point.z ? point : { x: point.x, z };
}

/** Keep a clipped leap within its cast disc even when the rear edge moves past the caster. */
export function limitRaidLeap(caster: RaidPoint, requested: RaidPoint, range: number): RaidPoint {
  const point = limitRaidPlacement(requested, RAID_LEAP_TICKS);
  if (point === requested || point.z <= caster.z || point.z <= requested.z) return point;
  const halfWidth = Math.sqrt(Math.max(0, range * range - (point.z - caster.z) ** 2));
  const x = clamp(point.x, caster.x - halfWidth, caster.x + halfWidth);
  return { x, z: point.z };
}

/** Intersect the dash segment with either longitudinal limit. Return a road endpoint at cast time. */
export function limitRaidDash(from: RaidPoint, to: RaidPoint, ticks: number): RaidPoint {
  const travel = raidRoadTravel(ticks);
  const arrivalZ = to.z - travel;
  if (arrivalZ >= RAID_REAR_Z && arrivalZ <= RAID_FRONT_Z) return to;
  const edge = clamp(arrivalZ, RAID_REAR_Z, RAID_FRONT_Z);
  const fraction = (edge - from.z) / (arrivalZ - from.z);
  return { x: from.x + (to.x - from.x) * fraction, z: edge + travel };
}
// The aerial volley is steered relative to the chase formation throughout the flip.
export function limitAerialVolley(from: RaidPoint, to: RaidPoint) {
  const end = limitRaidDash(from, to, 0);
  const x = clamp(end.x, Math.min(from.x, -RAID_RUN_LIMIT_X), Math.max(from.x, RAID_RUN_LIMIT_X));
  return x === end.x
    ? end
    : { x, z: from.z + ((end.z - from.z) * (x - from.x)) / (end.x - from.x) };
}
// Outside the running corridor after a leap, return at running speed without snapping to its edge.
function runAxis(position: number, delta: number, low: number, high: number, recovery: number) {
  return clamp(
    position + delta,
    Math.min(low, position + recovery),
    Math.max(high, position - recovery),
  );
}
export function raidRunnerHeight(r: RaidRunner, subtick = 0) {
  if (r.dash?.aerialVolley) {
    // The Max take flips around the pelvis. The moving character supplies the lift above the road.
    const age = r.dash.elapsed + subtick;
    const rise = clamp((age - 3) / 5, 0, 1);
    const fall = clamp((36 - age) / 8, 0, 1);
    const smooth = (t: number) => t * t * (3 - 2 * t);
    return 2.1 * smooth(rise) * smooth(fall) + (r.dash.takeoffHeight ?? 0) * (1 - smooth(rise));
  }
  if (r.air && !r.launchDuration) return airHeightAfter(r, subtick);
  return r.leap
    ? raidLeapHeight(Math.min(1, (r.leap.elapsed + subtick) / RAID_LEAP_TICKS))
    : jumpHeight(
        Math.max(0, r.jumping - subtick),
        r.launchDuration || (r.heroView.escapeTicks ? 2 * RAID_HZ : RAID_JUMP_TICKS),
      );
}
/** Predict up to one tick from the current ground position for both the match and the camera. */
export function raidRunnerPositionAfter(r: RaidRunner, ticks: number): RaidPoint {
  if (r.stunned || r.launchDuration || (r.staggered && !r.leap)) return { x: r.x, z: r.z };
  if (r.heroView.rootedTicks)
    return { x: r.x, z: Math.max(RAID_REAR_Z, r.z - raidRoadTravel(ticks)) };
  const dash = r.dash;
  const motion = dash ?? r.leap;
  if (motion) {
    // Skill endpoints are road positions sampled in the wagon frame when the cast starts.
    // Convert the interpolated position back into the current frame exactly once.
    const { from, to, elapsed } = motion;
    const duration = dash?.ticks ?? RAID_LEAP_TICKS;
    const age = Math.min(duration, elapsed + ticks);
    if (dash?.aerialVolley) {
      const t = clamp((age - 3) / 33, 0, 1);
      return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
    }
    const t = age / duration;
    return raidGroundPointAfter(
      { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t },
      age,
    );
  }
  // Keep steering intent through a stagger so held controls resume on recovery.
  const speed = (1 - (activeSlow(r)?.percent ?? 0) / 100) * (r.hasteTicks ? 1.2 : 1);
  const seconds = r.respawn ? 0 : (ticks / RAID_HZ) * speed;
  return {
    x: runAxis(r.x, r.side * 4.8 * seconds, -RAID_RUN_LIMIT_X, RAID_RUN_LIMIT_X, 4.8 * seconds),
    z: runAxis(
      r.z,
      r.respawn ? 0 : forwardTravel(r, ticks) * speed,
      RAID_REAR_Z,
      RAID_FRONT_Z,
      -BRAKE_SPEED * seconds,
    ),
  };
}
export function jumpHeight(ticks: number, duration = RAID_JUMP_TICKS) {
  const t = clamp(ticks / duration, 0, 1);
  return 4 * 3.2 * t * (1 - t);
}
