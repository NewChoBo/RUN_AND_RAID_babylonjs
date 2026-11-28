import { chartStats } from '../base-stats.ts';
import { RAID_HZ } from '../../../game/raid/raid-rules.ts';

export const stats = { ...chartStats.kali, power: 9, reach: 3, radius: 3 } as const;
export const shadow = {
  comboLimit: 3,
  comboLifetime: 5 * RAID_HZ,
  comboDamage: 9,
  poisonCount: 3,
  poisonInterval: RAID_HZ,
  stepRange: 13,
  bladeRange: 7,
  bladeHalfWidth: 1.05,
  bladeTravelTicks: 12,
  bladeInterval: 3 * RAID_HZ,
  bladeCasts: 3,
} as const;
