import { SKILL_COOLDOWNS } from '../raid-rules.ts';
import { matchedCooldownTicks } from '../../../content/raid/skill-cooldowns.ts';
import { actionLocked } from '../raid-control.ts';
import type { RaidHeroDefinition, HeroStats } from './hero-definition.ts';
import { HERO_IDS, heroKit, type HeroKit, type RaidHero } from './hero-id.ts';
import type { Skill, RaidRunner } from '../raid-view.ts';
import { hammer } from './hammer.ts';
import { abyss } from './abyss.ts';
import { longshot } from './longshot.ts';
import { jade } from './jade.ts';
import { rend } from './rend.ts';
import { bastion } from './bastion.ts';
import { rime } from './rime.ts';
import { rildin } from './rildin.ts';
import { kaiken } from './kaiken.ts';
import { swift } from './swift.ts';
import { kali } from './kali.ts';
import { drizz } from './drizz.ts';
import { alice } from './alice.ts';
import { froze, theresa, hof, vallet, freesia } from './archive-champions.ts';
import { flare } from './flare.ts';
import { magnus } from './magnus.ts';
const kits = {
  hammer,
  abyss,
  longshot,
  jade,
  rend,
  bastion,
  rime,
  rildin,
  kaiken,
  swift,
  kali,
  drizz,
  alice,
  flare,
  froze,
  theresa,
  hof,
  vallet,
  freesia,
  magnus,
} satisfies Record<HeroKit, RaidHeroDefinition>;
export const heroCatalog = Object.fromEntries(
  HERO_IDS.map((id) => [id, kits[heroKit(id)]]),
) as Record<RaidHero, RaidHeroDefinition>;
export const HEROES = Object.fromEntries(
  HERO_IDS.map((id) => [id, heroCatalog[id].stats]),
) as Record<RaidHero, HeroStats>;
export const raidSkill = (hero: RaidHero, skill: Skill) => heroCatalog[hero].skills[skill];
export const raidSkillCooldown = (hero: RaidHero, skill: Skill) =>
  matchedCooldownTicks(hero, skill) ??
  raidSkill(hero, skill).cooldownTicks ??
  SKILL_COOLDOWNS[skill];
export const raidBasicReach = (runner: RaidRunner, tick: number) =>
  heroCatalog[runner.hero].basicReach(runner, tick);
export const raidAimKind = (hero: RaidHero, skill: Skill) => raidSkill(hero, skill).kind;
export function raidProjectileProfile(hero: RaidHero, skill: Skill) {
  const { attack } = raidSkill(hero, skill);
  return attack.kind === 'projectile' ? attack.flight : undefined;
}
export const raidRunnerAimKind = (runner: RaidRunner, skill: Skill) =>
  raidAimKind(runner.hero, skill);
export const isRaidLeap = (hero: RaidHero, skill: Skill) => raidAimKind(hero, skill) === 'leap';
export function canUseRaidSkill(runner: RaidRunner, skill: Skill) {
  if (
    runner.respawn ||
    runner.silenced ||
    runner.taunt ||
    actionLocked(runner) ||
    runner.leap ||
    runner.spinTicks
  )
    return false;
  const rule = raidSkill(runner.hero, skill);
  if (runner.dash)
    return runner.dash.skill === skill && rule.kind === 'pulse' && !!rule.recastDuringDash;
  return (
    !runner.cooldowns[skill] &&
    (!rule.available || rule.available(runner)) &&
    (!rule.requiresJump || runner.jumping > 0) &&
    !(rule.kind === 'leap' && runner.jumping) &&
    (skill !== 3 || rule.noRageCost || runner.rage >= 100 || !!runner.heroView.ultimateRecasts)
  );
}
