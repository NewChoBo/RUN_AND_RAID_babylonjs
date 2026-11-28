export const RAID_HZ = 30;
export const RAID_ROAD_WIDTH = 18;
// Runner centre to paving edge, estimated from the near-wall chase in docs/CAMERA.md.
export const RAID_RUN_LIMIT_X = RAID_ROAD_WIDTH / 2 - 2.4;
export const ROUND_TICKS = 180 * RAID_HZ;
// Calibrated for the three-minute chase with ultimates charged by incoming damage.
export const WAGON_HP = 6300;
/** Count this knockout. Each runner starts a fresh progression in the next match. */
export const raidRespawnTicks = (deaths: number) =>
  Math.min(35, 10 + 5 * Math.max(0, deaths - 1)) * RAID_HZ;
export const SKILL_COOLDOWNS = [150, 105, 210, 30] as const;
export const RAID_LEAP_TICKS = 15;
export const RAID_SKILL_RANGE = { field: 15, shot: 16, ward: 8, leap: 10 } as const;
// Fixed chase-frame reference for road rows and runner limits. The body moves around it.
export const WAGON = { x: 0, z: 10 } as const;
export const RAID_TARGETS = ['wagon', 0, 1, 2, 3] as const;
export const distance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
