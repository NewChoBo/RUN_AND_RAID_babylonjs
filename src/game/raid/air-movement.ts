import { actionLocked } from './raid-control.ts';
import type { RaidRunner, Runner } from './raid-view.ts';

export const RAID_JUMP_TICKS = 22;
export const JET_CAPACITY = 60;
const apex = 3.2;
const impulse = (4 * apex) / RAID_JUMP_TICKS;
const gravity = (2 * impulse) / RAID_JUMP_TICKS;
const jetCeiling = 5;

export interface AirMovement {
  height: number;
  speed: number;
  elapsed: number;
  second: boolean;
  thrust: boolean;
}

export function canPressJump(r: RaidRunner) {
  if (r.respawn || r.leap || r.dash || actionLocked(r) || r.heroView.orbTicks) return false;
  if (r.hero === 'kaiken' && r.spin) return false;
  if (!r.jumping) return true;
  if (!r.air) return false;
  if (r.hero === 'longshot') return !r.air.second;
  return r.jetFuel !== undefined && r.jetFuel > 0;
}

export function startRaidJump(r: Runner, held: boolean) {
  if (!canPressJump(r)) return false;
  if (r.hero !== 'longshot' && r.jetFuel === undefined) {
    r.jumping = RAID_JUMP_TICKS;
    return true;
  }
  if (r.air && r.jetFuel !== undefined) {
    if (!held) return false;
    r.air.thrust = true;
    return true;
  }
  const height = r.air?.height ?? 0;
  r.air = {
    height,
    speed: impulse,
    elapsed: 0,
    second: !!r.air,
    thrust: held && r.jetFuel !== undefined,
  };
  r.jumping = flightTicks(height, impulse);
  return true;
}

function flightTicks(height: number, speed: number) {
  return Math.ceil((speed + Math.sqrt(speed * speed + 2 * gravity * height)) / gravity - 1e-8);
}

export function isJetFiring(r: RaidRunner) {
  return !!r.air?.thrust && !!r.jetFuel && !actionLocked(r) && r.air.speed <= 0.12;
}

export function airHeightAfter(r: RaidRunner, ticks: number) {
  const air = r.air!;
  if (isJetFiring(r)) return Math.min(jetCeiling, air.height + 0.12 * ticks);
  return Math.max(0, air.height + air.speed * ticks - (gravity * ticks * ticks) / 2);
}

/** Advance once on the authoritative tick. A released engine can be fired again before landing. */
export function advanceRaidAir(r: Runner) {
  const air = r.air;
  if (!air) {
    if (r.jetFuel !== undefined && !r.jumping) r.jetFuel = Math.min(JET_CAPACITY, r.jetFuel + 0.5);
    if (r.jumping && !r.launchDuration) r.jumping--;
    return;
  }
  if (actionLocked(r)) air.thrust = false;
  const burn = isJetFiring(r);
  air.height = airHeightAfter(r, 1);
  air.speed = burn ? (air.height < jetCeiling ? 0.12 : 0) : air.speed - gravity;
  air.elapsed++;
  if (burn) r.jetFuel = Math.max(0, r.jetFuel! - 1);
  r.jumping = air.height > 1e-8 ? Math.max(1, flightTicks(air.height, air.speed)) : 0;
  if (!r.jumping) r.air = null;
}
