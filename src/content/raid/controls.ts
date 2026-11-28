// Screen distances use CSS pixels. Stick fractions are relative to its displayed diameter.
export const RAID_TOUCH = {
  targetRadiusPx: 22,
  skillDragThresholdPx: 12,
  pingDragThresholdPx: 15,
  directionDeadZone: 0.07,
  directionThumbTravel: 0.33,
} as const;

export const RAID_CONTROL_RANGES = {
  raidSkillSize: { min: 80, max: 140, step: 5, defaultValue: 100 },
  raidHudPadding: { min: 0, max: 24, step: 2, defaultValue: 0 },
  sensitivity: { min: 0.25, max: 3, step: 0.05, defaultValue: 1 },
} as const;

export const RAID_SHORTCUTS = {
  skills: ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
  repeatModifier: 'Shift',
  ping: 'KeyG',
} as const;
