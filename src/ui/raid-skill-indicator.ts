import { raidText as t } from '../content/locales/run-and-raid.ts';
import { canUseRaidSkill, isRaidSpinCancel, raidSkill } from '../game/raid/heroes/hero-catalog.ts';
import { RAID_HZ } from '../game/raid/raid-rules.ts';
import type { RaidRunner, Skill } from '../game/raid/raid-view.ts';

export function raidSkillIndicator(runner: RaidRunner, slot: Skill) {
  const rule = raidSkill(runner.hero, slot);
  const cancelActive =
    (runner.dash?.skill === slot && rule.kind === 'pulse' && !!rule.recastDuringDash) ||
    isRaidSpinCancel(runner, slot);
  const land = slot === 2 && !!runner.heroView.escapeTicks;
  const ticks = cancelActive || land ? 0 : runner.cooldowns[slot]!;
  const seconds =
    ticks < RAID_HZ ? Math.ceil((ticks * 10) / RAID_HZ) / 10 : Math.ceil(ticks / RAID_HZ);
  const degrees = Math.round(
    360 * Math.min(1, ticks / Math.max(1, runner.cooldownDurations[slot]!)),
  );
  const usesRage = slot === 3 && !rule.noRageCost;
  let value = '';
  if (ticks) value = String(seconds);
  else if (usesRage && runner.heroView.ultimateRecasts)
    value = t('bladeCharges', { count: runner.heroView.ultimateRecasts });
  else if (usesRage && runner.rage < 100) value = Math.floor(runner.rage) + '%';
  else if (slot === 0 && runner.heroView.slashes) value = 4 - runner.heroView.slashes + '/4';
  return {
    kind: rule.kind,
    ready: canUseRaidSkill(runner, slot),
    cancelActive,
    land,
    ticks,
    degrees,
    usesRage,
    value,
  };
}
