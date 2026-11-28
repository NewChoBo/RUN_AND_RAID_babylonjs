export const RAID_LIGHTNING_ART = {
  straight: { glow: [0.12, 0.48, 1], core: [0.78, 0.96, 1] },
  zigzag: { glow: [0.4, 0.83, 0.07], core: [1, 1, 0.6] },
  groundOffsetMetres: 0.045,
  pillar: {
    heightMetres: 5.8,
    widthInCells: 0.52,
    footWidthInCells: 0.34,
    footDepthInCells: 0.28,
    warningWidthScale: 0.6,
    warningHeightScale: 0.48,
    warningHeightGrowth: 0.16,
  },
  brightness: {
    warningBase: 0.31,
    warningGain: 0.29,
    afterglow: 0.72,
    impactGain: 0.22,
    fadeTicks: 2,
  },
} as const;
