import type { RaidRageLoadout } from '../../content/raid/rage.ts';
import type { SkillKind } from './skills/skill-rule.ts';
import type { AirMovement } from './air-movement.ts';
import type { HeroView } from './heroes/hero-definition.ts';
import type { RaidHero } from './heroes/hero-id.ts';
import type { RaidControl } from './raid-control.ts';
import type { RaidCounter } from './raid-boss.ts';
import type { RaidProjectile } from './raid-projectiles.ts';
import type { ProjectileProfile } from './skills/attack-rule.ts';
export interface RaidDash {
  skill: Skill;
  // Road endpoints in the wagon frame at cast time, including the sampled aim of a targeted dash.
  from: RaidPoint;
  to: RaidPoint;
  elapsed: number;
  ticks: number;
  target?: RaidTarget;
  readonly aerialVolley?: boolean;
  readonly takeoffHeight?: number;
  readonly struck?: RaidTarget[];
}
/** Positions are metres relative to the moving wagon, +Z in the direction of travel. */
export interface RaidPoint {
  x: number;
  z: number;
}
export type RaidTarget = 'wagon' | number;
export interface RaidHealingFlight extends Readonly<RaidPoint> {
  readonly started: number;
  readonly arrives: number;
  readonly elevation: number;
  readonly victim: number;
  readonly killer: number;
  readonly target: number;
}
export type RaidMovementPing = 'advance' | 'retreat';
export type RaidPing = RaidMovementPing | 'enemy1' | 'enemy2';
export const enemySlots = [
  [2, 3],
  [0, 1],
] as const;
type RaidCall = Readonly<
  { from: number; until: number } & ({ target: RaidTarget } | { movement: RaidMovementPing })
>;
/** Effective HP delta at the impact position, in the wagon frame. A null source is the boss. */
export interface RaidHealthChange extends Readonly<RaidPoint> {
  readonly tick: number;
  /** KO recovery is applied with the kill, but the number and crosses arrive with the energy. */
  readonly displayTick?: number;
  readonly from: number | null;
  readonly target: RaidTarget;
  readonly amount: number;
  readonly elevation: number;
}
export type Skill = 0 | 1 | 2 | 3;
export interface RaidAim {
  kind: SkillKind;
  flight?: Pick<ProjectileProfile, 'angles' | 'guide' | 'contact'>;
  /** End of the directional dash in the wagon frame at arrival, once a direction is chosen. */
  dash?: { ticks: number; aerialVolley?: boolean; end: RaidPoint | null };
  /** Runner's bounded landing position in cast-time road coordinates. The impact uses point. */
  landing?: RaidPoint;
  status: 'needDirection' | 'ready' | 'needTarget' | 'outOfRange' | 'invalidGround' | 'unavailable';
  origin: Readonly<RaidPoint>;
  point: Readonly<RaidPoint> | null;
  range: number;
  radius: number;
  distance: number | null;
  target?: RaidTarget;
  count?: number;
  allies?: number;
}
export type Team = 0 | 1;
export interface RaidAction {
  readonly fieldTicks?: number;
  readonly basicSpeed?: number;
  readonly cancelledAt?: number;
  readonly comboStep?: number;
  readonly lines?: readonly { from: RaidPoint; to: RaidPoint }[];
  readonly id: number;
  readonly tick: number;
  readonly slot: number;
  readonly hero: RaidHero;
  readonly skill: Skill | 'basic';
  readonly phase?: 'ground' | 'dash' | 'spin';
  readonly from: Readonly<RaidPoint>;
  readonly to: Readonly<RaidPoint>;
  // Capture the footprint at emission so later buffs or movement cannot resize an old impact.
  readonly footprint?: { readonly radius: number; readonly halfAngle?: number };
  readonly fromY: number;
  readonly toY: number;
}

export interface Runner extends RaidPoint, RaidControl {
  air: AirMovement | null;
  jetFuel?: number;
  readonly spinTicks: number;
  spin: {
    skill: Skill;
    remaining: number;
    duration: number;
    interval: number;
    radius: number;
    cancelCue?: RaidAction & { cancelledAt?: number };
  } | null;
  dash: RaidDash | null;
  readonly heroView: HeroView;
  slot: number;
  team: Team;
  hero: RaidHero;
  hp: number;
  rage: number;
  readonly rageLoadout: RaidRageLoadout;
  lastStrike: RaidTarget | null;
  lastWard: number | null;
  side: number;
  brake: number;
  appliedBrake: number;
  jumping: number;
  // Both endpoints describe fixed road positions in the wagon frame at takeoff.
  leap: Readonly<{
    skill: Skill;
    from: Readonly<RaidPoint>;
    to: Readonly<RaidPoint>;
    elapsed: number;
  }> | null;
  respawn: number;
  basic: number;
  cooldowns: number[];
  shield: number;
  barrier: { amount: number; until: number } | null;
  taunt: { from: number; until: number } | null;
  hasteTicks: number;
  blindUntil: number;
  controlGuardUntil: number;
  readonly slowed: number;
  launchDuration: number;
  cooldownDurations: number[];
  kills: number;
  wagonDamage: number;
  deaths: number;
  assists: number;
}
export type RaidRunner = Readonly<Omit<Runner, 'cooldowns'>> & {
  readonly cooldowns: readonly number[];
};
export interface RaidView {
  readonly healingFlights: readonly RaidHealingFlight[];
  readonly healthChanges: readonly RaidHealthChange[];
  readonly calls: readonly (RaidCall | null)[];
  readonly projectiles: readonly RaidProjectile[];
  /** Last position of each shot that ended on this tick. Zero remaining travel prevents overshoot. */
  readonly endedProjectiles: readonly RaidProjectile[];
  readonly actions: readonly RaidAction[];
  readonly runners: readonly RaidRunner[];
  readonly damage: readonly number[];
  readonly leadChanges: number;
  readonly tick: number;
  readonly result: Readonly<{ reason: 'destruction' | 'time'; winner: Team | 'draw' }> | null;
  readonly hazard: RaidCounter | null;
}

export function activeTeamCall(view: RaidView, team: Team) {
  const call = view.calls[team];
  return call && !view.result && view.tick < call.until ? call : null;
}
