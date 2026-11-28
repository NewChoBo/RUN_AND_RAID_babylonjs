import { RAID_ROAD_WIDTH } from '../../game/raid/raid-rules.ts';

// Distances are metres. Adjacent pillars in the reference footage are about 1/8 road width apart.
const columns = 8;
export const RAID_ELECTRIC_GRID = {
  columns,
  width: RAID_ROAD_WIDTH / columns,
  depth: 3.6,
} as const;

// Windup, impact and stun durations are simulation ticks. Stun time is a remake tuning value.
export const RAID_COUNTERS = {
  low: { windup: 30, active: 7, damage: 20, stunTicks: 18 },
  pillar: { windup: 42, active: 9, damage: 26, stunTicks: 18 },
} as const;

const narrowBank = 3;
const wideBank = 5;
export const RAID_LIGHTNING = {
  firstWarningTick: 60,
  attackIntervalTicks: 144,
  ticksPerRow: 6,
  zigzagFromRoundFraction: 0.5,
  lowJumpClearance: 0.6,
  pillarBanks: [
    { side: 'left', span: wideBank },
    { side: 'right', span: narrowBank },
    { side: 'left', span: narrowBank },
    { side: 'right', span: wideBank },
  ],
} as const;
