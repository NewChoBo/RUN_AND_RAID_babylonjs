import { normalizeRaidRageLoadout, type RaidRageLoadout } from '../../content/raid/rage.ts';
import { actionLocked, activeSlow, advanceSlows } from './raid-control.ts';
import { advanceRaidAir, JET_CAPACITY, startRaidJump } from './air-movement.ts';
import { triggerAttack } from './skills/skill-execution.ts';
import { measureSkill } from './skills/skill-range.ts';
import { strikeAlongDash } from './skills/dash-path.ts';
import { areaRadius } from './skills/attack-area.ts';
import {
  attackArea,
  type HitRule,
  type AreaAttack,
  type ProjectileAttack,
} from './skills/attack-rule.ts';
import { RaidProjectiles, type RaidDirection } from './raid-projectiles.ts';
import { RaidFields } from './combat/active-fields.ts';
import { RaidHitResolution } from './combat/hit-resolution.ts';
export { raidBossBonusPercent } from './combat/hit-resolution.ts';
import { RaidBoss } from './raid-boss.ts';
import {
  inBasicAttackArc,
  inRaidSight,
  raidAimPullback,
  RAID_BASIC_HALF_ANGLE,
  visibleWagonSide,
} from './raid-sight.ts';
import { WAGON_BODY, wagonCenter, wagonContact, wagonSectorContact } from './wagon.ts';
import { raidActiveAction, raidFacing } from './raid-facing.ts';
import {
  HEROES,
  heroCatalog,
  raidBasicReach,
  canUseRaidSkill,
  raidSkill,
  raidSkillCooldown,
} from './heroes/hero-catalog.ts';
import type { RaidHero } from './heroes/hero-id.ts';
import type { HeroCombat, HeroView, RaidHeroRuntime } from './heroes/hero-definition.ts';
import { castInput, resolveSkill, type TargetRead } from './skills/skill-targeting.ts';
import { LastAim } from './skills/last-aim.ts';
import {
  RAID_HZ,
  RAID_LEAP_TICKS,
  RAID_SKILL_RANGE,
  RAID_TARGETS,
  ROUND_TICKS,
  WAGON_HP,
  distance,
} from './raid-rules.ts';
import {
  raidBrakeAfter,
  limitRaidDash,
  limitRaidPlacement,
  raidGroundPointAfter,
  raidRunnerHeight,
  raidRunnerPositionAfter,
} from './runner-motion.ts';
import { enemySlots, type RaidPing } from './raid-view.ts';
import type {
  RaidAction,
  RaidAim,
  RaidPoint,
  RaidRunner,
  RaidTarget,
  RaidView,
  Runner,
  Skill,
  Team,
} from './raid-view.ts';
export type { RaidHero } from './heroes/hero-id.ts';
export { HERO_IDS } from './heroes/hero-id.ts';
export {
  HEROES,
  raidAimKind,
  raidBasicReach,
  raidRunnerAimKind,
  canUseRaidSkill,
  isRaidLeap,
} from './heroes/hero-catalog.ts';
export {
  RAID_HZ,
  RAID_LEAP_TICKS,
  RAID_SKILL_RANGE,
  raidRespawnTicks,
  ROUND_TICKS,
  SKILL_COOLDOWNS,
  WAGON,
  WAGON_HP,
} from './raid-rules.ts';
export * from './runner-motion.ts';
export type {
  RaidAction,
  RaidAim,
  RaidPoint,
  RaidRunner,
  RaidTarget,
  RaidView,
  Skill,
} from './raid-view.ts';
const emptyView: HeroView = Object.freeze({});
const standardAspect = 16 / 9;
export function inRaidCastRange(caster: RaidPoint, point: RaidPoint, skill: Skill) {
  return distance(caster, point) <= (skill === 2 ? RAID_SKILL_RANGE.field : RAID_SKILL_RANGE.shot);
}
const spawnX = [-1.6, -3.3, 1.6, 3.3];
const makeRunner = (
  hero: RaidHero,
  slot: number,
  view: () => HeroView,
  rageLoadout: RaidRageLoadout,
): Runner => ({
  spin: null,
  get spinTicks() {
    return this.spin?.remaining ?? 0;
  },
  dash: null,
  get heroView() {
    return view();
  },
  hero,
  slot,
  team: slot < 2 ? 0 : 1,
  x: spawnX[slot]!,
  z: slot % 2 === 0 ? 0 : -2,
  hp: HEROES[hero].hp,
  rage: 0,
  rageLoadout,
  lastStrike: null,
  lastWard: null,
  side: 0,
  brake: 0,
  appliedBrake: 0,
  jumping: 0,
  air: null,
  jetFuel: hero === 'hof' ? JET_CAPACITY : undefined,
  leap: null,
  respawn: 0,
  basic: 0,
  cooldowns: [0, 0, 0, 0],
  shield: 0,
  barrier: null,
  taunt: null,
  silenced: 0,
  slows: [],
  get slowed() {
    return activeSlow(this)?.ticks ?? 0;
  },
  stunned: 0,
  launchDuration: 0,
  staggered: 0,
  staggerGuard: 0,
  hasteTicks: 0,
  blindUntil: 0,
  controlGuardUntil: 0,
  cooldownDurations: [0, 0, 0, 0],
  kills: 0,
  wagonDamage: 0,
  deaths: 0,
  assists: 0,
});

/** The authority advances exactly one tick per step. All damage in a tick resolves together. */
export class RaidMatch implements RaidView {
  readonly #runners: Runner[];
  readonly #heroes: RaidHeroRuntime[];
  readonly #contexts: (HeroCombat & TargetRead)[];
  readonly #lastAim: LastAim[];

  readonly #playerAspect: () => number;

  #lastLeader: Team | null = null;
  #leadChanges = 0;
  #tick = 0;
  readonly #calls: Array<RaidView['calls'][number]> = [null, null];
  get calls(): RaidView['calls'] {
    return this.#calls;
  }
  #result: RaidView['result'] = null;
  readonly #boss = new RaidBoss();
  readonly #bossHit = (slot: number, amount: number) => {
    this.#hits.enqueue({ from: null, target: slot, amount });
  };
  readonly #hits: RaidHitResolution;
  readonly #projectiles = new RaidProjectiles();
  readonly #charging = new Map<
    number,
    {
      release: number;
      skill: Skill;
      direction: RaidDirection;
      attack: ProjectileAttack;
      cue: RaidAction & { cancelledAt?: number };
    }
  >();
  get projectiles() {
    return this.#projectiles.active;
  }
  get endedProjectiles() {
    return this.#projectiles.ended;
  }
  #sequence = 0;
  #actions: RaidAction[] = [];
  readonly #fields = new RaidFields();
  get actions(): readonly RaidAction[] {
    return this.#actions;
  }
  constructor(
    hero: RaidHero | readonly RaidHero[] = 'hammer',
    playerAspect: () => number = () => standardAspect,
    loadouts: readonly RaidRageLoadout[] = [],
  ) {
    const heroes =
      typeof hero === 'string'
        ? [
            hero,
            ...(['hammer', 'abyss', 'longshot', 'jade'] as const)
              .filter((id) => id !== hero)
              .slice(0, 3),
          ]
        : hero;
    this.#heroes = heroes.map((id) => heroCatalog[id].create());
    this.#runners = heroes.map((id, slot) =>
      makeRunner(
        id,
        slot,
        () => this.#heroes[slot]!.events.view ?? emptyView,
        normalizeRaidRageLoadout(id, loadouts[slot]),
      ),
    );
    this.#contexts = this.#runners.map((r) => this.#combat(r));
    this.#lastAim = heroes.map(() => new LastAim());
    this.#hits = new RaidHitResolution(
      this.#contexts,
      (slot) => this.#heroes[slot]!.events,
      (slot) => {
        this.#lastAim[slot] = new LastAim();
        for (const aim of this.#lastAim) aim.forgetTarget(slot);
        const events = this.#heroes[slot]!.events;
        if (events.onKnockout) return events.onKnockout(this.#contexts[slot]!);
        this.#heroes[slot] = heroCatalog[this.#runners[slot]!.hero].create();
      },
    );
    this.#playerAspect = playerAspect;
  }
  get runners(): readonly RaidRunner[] {
    return this.#runners;
  }
  get damage(): readonly number[] {
    return this.#hits.damage;
  }
  get healthChanges() {
    return this.#hits.healthChanges;
  }
  get healingFlights() {
    return this.#hits.healingFlights;
  }
  get leadChanges() {
    return this.#leadChanges;
  }
  get tick() {
    return this.#tick;
  }
  get result() {
    return this.#result;
  }
  get hazard(): RaidView['hazard'] {
    return this.#boss.counter;
  }
  #active(slot: number) {
    const r = this.#runners[slot];
    return r && !r.respawn && !this.#result ? r : undefined;
  }
  move(slot: number, side: number, brake: number) {
    const r = this.#active(slot);
    if (!r || !(side >= -1 && side <= 1 && brake >= 0 && brake <= 1)) return false;
    r.side = side;
    r.brake = brake;
    return true;
  }
  jump(slot: number, held?: boolean) {
    const r = this.#active(slot);
    if (!r) return false;
    if (held === false) {
      if (r.jetFuel === undefined) return false;
      if (r.air) r.air.thrust = false;
      return true;
    }
    return startRaidJump(r, held === true);
  }
  #position(r: Runner, target: RaidTarget, from: RaidPoint = r): RaidPoint | Runner | undefined {
    if (target === 'wagon') return wagonContact(from, this.tick);
    const other = this.#runners[target];
    return other && other.team !== r.team && !other.respawn ? other : undefined;
  }
  #visibleTarget(r: Runner, target: RaidTarget, pullback = 0) {
    const point = this.#position(r, target);
    if (!point) return;
    if (target === 'wagon') return this.#visibleWagonSide(r, point, pullback);
    if ('heroView' in point && (point.heroView.concealedUntil ?? 0) > this.tick) return;
    const height = 'jumping' in point ? 1 + raidRunnerHeight(point) : 2;
    if (this.#inSight(r, point, height, pullback)) return point;
  }
  #visibleWagonSide(r: Runner, near: RaidPoint, pullback = 0) {
    const farZ = wagonCenter(this.tick).z + WAGON_BODY.halfDepth;
    return visibleWagonSide(
      r,
      near,
      farZ,
      r.slot === 0 ? this.#playerAspect() : standardAspect,
      pullback,
    );
  }
  #inSight(r: Runner, point: RaidPoint, height: number, pullback: number) {
    // Bots see their own chase view, independently of the local player's device.
    return inRaidSight(
      r,
      point,
      height,
      r.slot === 0 ? this.#playerAspect() : standardAspect,
      pullback,
    );
  }
  canAimGround(slot: number, point: RaidPoint, skill: Skill = 2) {
    const r = this.#active(slot);
    if (!r) return false;
    const kind = raidSkill(r.hero, skill).kind;
    return (
      (kind === 'field' || kind === 'leap') &&
      distance(r, point) <= this.skillRange(slot, skill).range
    );
  }
  #wardInRange(slot: number, ally: number, range: number) {
    const caster = this.#active(slot);
    const recipient = this.#active(ally);
    return (
      !!caster &&
      !!recipient &&
      recipient.team === caster.team &&
      distance(caster, recipient) <= range &&
      (slot === ally ||
        this.#inSight(caster, recipient, 1 + raidRunnerHeight(recipient), raidAimPullback('ward')))
    );
  }
  canShield(slot: number, ally: number) {
    const caster = this.#active(slot);
    return (
      !!caster &&
      heroCatalog[caster.hero].skills.some(
        (rule) =>
          (rule.kind === 'ward' || (rule.kind === 'target' && rule.allyEffect)) &&
          this.#wardInRange(slot, ally, rule.range),
      )
    );
  }
  canTarget(slot: number, target: RaidTarget) {
    const r = this.#active(slot);
    return !!r && !!this.#visibleTarget(r, target);
  }
  #areaTargets(r: Runner, center: RaidPoint, radius: number) {
    return RAID_TARGETS.filter((id) => {
      const point = this.#position(r, id, center);
      return point && distance(center, point) <= radius;
    });
  }
  #inHealingArea(caster: Runner, ally: Runner, center: RaidPoint, radius: number) {
    return !ally.respawn && ally.team === caster.team && distance(ally, center) <= radius;
  }
  #combat(r: Runner): HeroCombat & TargetRead {
    return {
      self: r,
      stats: HEROES[r.hero],
      tick: () => this.tick,
      position: (id, from) => this.#position(r, id, from),
      ally: (id) => {
        const ally = this.#runners[id];
        return ally?.team === r.team && !ally.respawn ? ally : undefined;
      },
      enemies: (p, radius) => this.#areaTargets(r, p, radius),
      allies: (p, radius) =>
        this.#runners
          .filter((ally) => this.#inHealingArea(r, ally, p, radius))
          .map((ally) => ally.slot),
      controlImmune: () =>
        r.controlGuardUntil > this.tick || !!this.#heroes[r.slot]!.events.resistsControl?.(r),
      height: raidRunnerHeight,
      targetPoint: (id, from = r) => {
        if (id !== 'wagon') return this.#runners[id] ?? null;
        const nearest = wagonContact(from, this.tick);
        return this.#visibleWagonSide(r, nearest, raidAimPullback('target')) ?? nearest;
      },
      canTarget: (id) =>
        !!this.#active(r.slot) && !!this.#visibleTarget(r, id, raidAimPullback('target')),
      canShield: (id, range) => this.#wardInRange(r.slot, id, range),
      alliesInArea: (p, radius) =>
        this.#runners.filter((ally) => this.#inHealingArea(r, ally, p, radius)).length,
      facing: (target = r.slot) =>
        target === 'wagon'
          ? 0
          : raidFacing(this.#runners[target]!, raidActiveAction(this.#actions, target, this.tick)),
      record: (skill, p, phase, detail) => this.#record(r, skill, p, phase, detail),
      haste: (id, ticks) => {
        this.#runners[id]!.hasteTicks = ticks;
      },
      strike: (id, hit, skill, designated) => {
        this.#strike(r, id, HEROES[r.hero].power * hit.powerScale, skill, designated, hit);
      },
      placeField: (skill, point, radius, pulse) =>
        this.#fields.place(r.slot, skill, this.tick, point, radius, pulse),
      dash: (skill, to, ticks, target) => this.#startDash(r, skill, to, ticks, target),
      blink: (point) => {
        const to = limitRaidPlacement(point);
        r.x = to.x;
        r.z = to.z;
      },
      finishDash: () => this.#finishDash(r),
      counter: (skill) => this.#impact(r, skill, 'counter'),
      fire: (skill, direction, attack) => {
        const profile = attack.flight;
        const cue = this.#record(r, skill, {
          x: r.x + direction.dx * profile.reach,
          z: r.z + direction.dz * profile.reach,
        });
        if (attack.windupTicks)
          this.#charging.set(r.slot, {
            release: this.tick + attack.windupTicks,
            skill,
            direction,
            attack,
            cue,
          });
        else this.#projectiles.launch(r, skill, direction, attack, RAID_HZ);
      },
      heal: (id, amount) => this.#hits.heal(this.tick, r, id, amount),
      barrier: (id, amount, ticks) => {
        this.#runners[id]!.barrier = { amount, until: this.tick + ticks };
      },
      guardControl: (id, ticks) => {
        const ally = this.#runners[id]!;
        ally.controlGuardUntil = Math.max(ally.controlGuardUntil, this.tick + ticks);
      },
    };
  }
  skillRange(slot: number, skill: Skill) {
    const combat = this.#contexts[slot]!;
    return measureSkill(raidSkill(combat.self.hero, skill), combat, skill);
  }
  previewSkill(slot: number, skill: Skill, ground: RaidPoint | null, target?: RaidTarget): RaidAim {
    const c = this.#contexts[slot]!;
    return resolveSkill(
      c,
      raidSkill(c.self.hero, skill),
      skill,
      !!this.#active(slot) && canUseRaidSkill(c.self, skill),
      ground,
      target,
    ).preview;
  }
  callTarget(slot: number, intent: RaidTarget | RaidPing) {
    const r = this.#active(slot);
    if (!r || this.#calls[r.team]) return false;
    const until = this.tick + 4 * RAID_HZ;
    if (intent === 'advance' || intent === 'retreat') {
      this.#calls[r.team] = { from: slot, movement: intent, until };
    } else {
      const portrait = intent === 'enemy1' || intent === 'enemy2';
      const target = portrait ? enemySlots[r.team][intent === 'enemy1' ? 0 : 1] : intent;
      if (!(portrait ? this.#position(r, target) : this.#visibleTarget(r, target))) return false;
      this.#calls[r.team] = { from: slot, target, until };
    }
    return true;
  }
  #repeatInput(slot: number, skill: Skill) {
    const c = this.#contexts[slot];
    if (!c) return undefined;
    return this.#lastAim[slot]!.input(
      c,
      raidSkill(c.self.hero, skill),
      this.skillRange(slot, skill).range,
    );
  }
  previewRepeat(slot: number, skill: Skill) {
    const aim = this.#repeatInput(slot, skill);
    if (aim === undefined) return null;
    const r = this.#runners[slot]!;
    const input = castInput(raidSkill(r.hero, skill), r, aim)!;
    return this.previewSkill(slot, skill, input.point, input.target);
  }
  repeatCast(slot: number, skill: Skill) {
    const aim = this.#repeatInput(slot, skill);
    return aim !== undefined && this.cast(slot, skill, aim);
  }
  #strike(
    r: Runner,
    target: RaidTarget,
    amount: number,
    skill?: Skill,
    designated = false,
    rule?: HitRule,
  ) {
    const point = this.#position(r, target);
    if (!point) return;
    this.#hits.enqueue({ from: r.slot, target, amount, skill, designated, rule });
  }
  #record(
    r: Runner,
    skill: RaidAction['skill'],
    point: RaidPoint,
    phase?: RaidAction['phase'],
    detail?: Pick<RaidAction, 'lines' | 'comboStep' | 'basicSpeed'>,
  ) {
    const target = this.#runners.find((other) => other === point);
    const attack = skill === 'basic' ? undefined : raidSkill(r.hero, skill).attack;
    const area =
      attack && phase !== 'dash' && !(attack.kind === 'area' && attack.on === 'counter')
        ? attackArea(attack)
        : undefined;
    const action = {
      id: ++this.#sequence,
      tick: this.#tick,
      slot: r.slot,
      hero: r.hero,
      skill,
      phase,
      fieldTicks:
        attack?.kind === 'field' && attack.pulse
          ? attack.pulse.intervalTicks * attack.pulse.count
          : undefined,
      ...detail,
      from: { x: r.x, z: r.z },
      footprint: area
        ? {
            radius: areaRadius(area, this.#contexts[r.slot]!),
            halfAngle: area.kind === 'sector' ? area.halfAngle : undefined,
          }
        : undefined,
      fromY: 1 + raidRunnerHeight(r),
      to: { x: point.x, z: point.z },
      toY:
        phase === 'ground' || phase === 'spin' ? 0.08 : target ? 1 + raidRunnerHeight(target) : 1.9,
    };
    this.#actions.push(action);
    return action;
  }
  #cancelCharge(slot: number) {
    const shot = this.#charging.get(slot);
    if (shot) {
      shot.cue.cancelledAt = this.tick;
      this.#charging.delete(slot);
    }
  }
  #startDash(r: Runner, skill: Skill, desired: RaidPoint, ticks: number, target?: RaidTarget) {
    const rule = raidSkill(r.hero, skill);
    const aerialVolley = 'travelTicks' in rule && rule.aerialVolley;
    const to = limitRaidDash(r, desired, aerialVolley ? 0 : ticks);
    const takeoffHeight = aerialVolley ? raidRunnerHeight(r) : undefined;
    if (aerialVolley) {
      r.jumping = 0;
      r.air = null;
    }
    this.#record(r, skill, to, 'dash');
    const struck = raidSkill(r.hero, skill).attack.kind === 'dashPath' ? [] : undefined;
    r.dash = {
      skill,
      from: { x: r.x, z: r.z },
      to,
      elapsed: 0,
      ticks,
      target,
      struck,
      aerialVolley,
      takeoffHeight,
    };
  }
  cast(slot: number, skill: Skill, aim?: RaidPoint | RaidTarget | RaidDirection) {
    const r = this.#active(slot);
    if (!r || ![0, 1, 2, 3].includes(skill) || !canUseRaidSkill(r, skill)) return false;
    const rule = raidSkill(r.hero, skill);
    const input = castInput(rule, r, aim);
    if (!input) return false;
    if (r.spin?.cancelCue) {
      r.spin.cancelCue.cancelledAt = this.tick;
      r.spin = null;
      return true;
    }
    const c = this.#contexts[slot]!;
    const { resolved } = resolveSkill(
      c,
      rule,
      skill,
      true,
      input.point,
      input.target,
      input.direction,
    );
    if (!resolved) return false;
    this.#lastAim[slot]!.remember(c, rule.kind, resolved);
    const hero = this.#heroes[slot]!;
    const spendRage = skill === 3 && !rule.noRageCost && !r.heroView.ultimateRecasts;
    this.#cancelCharge(slot);
    const finishingDash = !!r.dash && rule.kind === 'pulse' && rule.recastDuringDash;
    const landing = skill === 2 && !!r.heroView.escapeTicks;
    const cooldown = hero.cast(c, resolved) ?? raidSkillCooldown(r.hero, skill);
    if (spendRage) r.rage = 0;
    hero.events.onCast?.(c, skill);
    if (!finishingDash && !landing) r.cooldownDurations[skill] = r.cooldowns[skill] = cooldown;
    return true;
  }
  #impact(
    r: Runner,
    skill: Skill,
    event: Exclude<AreaAttack['on'], 'cast'>,
    center: RaidPoint = r,
    target?: RaidTarget,
  ) {
    triggerAttack(
      this.#contexts[r.slot]!,
      skill,
      raidSkill(r.hero, skill).attack,
      event,
      center,
      target,
    );
  }
  #finishDash(r: Runner) {
    const dash = r.dash!;
    r.dash = null;
    this.#heroes[r.slot]!.events.onDashEnd?.(this.#contexts[r.slot]!, dash.target);
    this.#impact(r, dash.skill, 'dashEnd', r, dash.target);
  }
  #basicTarget(r: Runner, target: RaidTarget) {
    if (target === 'wagon') {
      const point = wagonSectorContact(r, this.tick, RAID_BASIC_HALF_ANGLE);
      return point ? this.#visibleWagonSide(r, point) : undefined;
    }
    const point = this.#visibleTarget(r, target);
    return point && inBasicAttackArc(r, point) ? point : undefined;
  }
  #autoAttack(r: Runner) {
    const stats = HEROES[r.hero];
    let nearest = raidBasicReach(r, this.tick);
    let target: RaidTarget | undefined;
    let point: RaidPoint | undefined;
    const candidates = r.taunt ? [r.taunt.from] : RAID_TARGETS;
    for (const candidate of candidates) {
      const position = this.#basicTarget(r, candidate);
      if (!position) continue;
      const metres = distance(r, position);
      if (metres <= nearest) {
        nearest = metres;
        target = candidate;
        point = position;
      }
    }
    if (target === undefined || !point) return;
    const attack = this.#heroes[r.slot]!.events.onBasicAttack?.(this.#contexts[r.slot]!);
    this.#strike(r, target, attack?.amount ?? stats.basicAttack);
    r.basic = attack?.cooldown ?? stats.cooldown;
    this.#record(
      r,
      'basic',
      point,
      undefined,
      r.basic === stats.cooldown ? undefined : { basicSpeed: stats.cooldown / r.basic },
    );
  }
  step() {
    if (this.#result) return;
    this.#tick++;
    this.#projectiles.beginTick();
    const previous =
      this.projectiles.length || this.runners.some((r) => r.dash?.struck)
        ? this.runners.map((r) => ({ x: r.x, z: r.z, height: raidRunnerHeight(r) }))
        : null;
    while (this.#actions.length) {
      const first = this.#actions[0]!;
      if (this.#tick - first.tick < Math.max(40, (first.fieldTicks ?? 0) + 4)) break;
      this.#actions.shift();
    }
    for (const r of this.#runners) {
      for (const skill of [0, 1, 2, 3]) if (r.cooldowns[skill]!) r.cooldowns[skill]!--;
      if (r.respawn) {
        if (--r.respawn === 0) {
          r.hp = HEROES[r.hero].hp;
          if (r.jetFuel !== undefined) r.jetFuel = JET_CAPACITY;
          r.x = spawnX[r.slot]!;
          r.z = -6;
          if (previous) previous[r.slot] = { x: r.x, z: r.z, height: 0 };
          this.#heroes[r.slot]!.events.onRespawn?.(this.#contexts[r.slot]!);
          r.shield = 45;
        }
        continue;
      }
      if (actionLocked(r)) {
        if (r.stunned) r.leap = null;
        r.dash = null;
        this.#cancelCharge(r.slot);
      }
      if (r.spinTicks && this.#contexts[r.slot]!.controlImmune()) r.slows.length = 0;
      const next = raidRunnerPositionAfter(r, 1);
      r.appliedBrake = raidBrakeAfter(r, 1);
      r.x = next.x;
      r.z = next.z;
      if (r.leap) r.leap = { ...r.leap, elapsed: r.leap.elapsed + 1 };
      if (r.silenced) r.silenced--;
      advanceSlows(r);
      if (r.hasteTicks) r.hasteTicks--;
      advanceRaidAir(r);
      if (r.shield) r.shield--;
      if (r.barrier && r.barrier.until <= this.tick) r.barrier = null;
      if (r.taunt && (r.taunt.until <= this.tick || this.#runners[r.taunt.from]!.respawn))
        r.taunt = null;
      this.#heroes[r.slot]!.events.onTimersAdvanced?.(this.#contexts[r.slot]!);
      if (r.basic) r.basic--;
    }
    // Everyone moves before checking range so runner ordering cannot change who gets a hit.
    for (const r of this.#runners) {
      if (r.dash) {
        const dash = r.dash;
        if (dash.struck && previous) {
          const attack = raidSkill(r.hero, dash.skill).attack;
          if (attack.kind === 'dashPath')
            strikeAlongDash(this.#contexts[r.slot]!, dash.skill, attack, dash.struck, previous);
        }
        if (++dash.elapsed === dash.ticks) this.#finishDash(r);
      } else if (r.leap?.elapsed === RAID_LEAP_TICKS) {
        const { skill, to, elapsed } = r.leap;
        const impact = raidGroundPointAfter(to, elapsed);
        r.leap = null;
        this.#record(r, skill, impact, 'ground');
        this.#impact(r, skill, 'land', impact);
      } else if (
        !r.respawn &&
        !r.leap &&
        !r.basic &&
        r.blindUntil <= this.tick &&
        !actionLocked(r) &&
        !r.spinTicks &&
        !this.#charging.has(r.slot)
      )
        this.#autoAttack(r);
      if (r.launchDuration && --r.jumping === 0) r.launchDuration = 0;
      if (r.stunned) r.stunned--;
      if (r.staggered) r.staggered--;
      if (r.staggerGuard) r.staggerGuard--;
      if (r.spin) {
        const spin = r.spin;
        if (--spin.remaining % spin.interval === 0) this.#impact(r, spin.skill, 'spinPulse');
        if (!spin.remaining) r.spin = null;
      }
    }
    for (const r of this.#runners) {
      if (!r.respawn) this.#heroes[r.slot]!.events.onBeforeHits?.(this.#contexts[r.slot]!);
    }
    this.#boss.step(this.#tick, this.runners, raidRunnerHeight, this.#bossHit);
    if (previous)
      this.#projectiles.step(
        this.runners,
        previous,
        this.tick,
        raidRunnerHeight,
        (slot, target, skill, hit) => {
          const c = this.#contexts[slot]!;
          if (!this.#heroes[slot]!.events.onProjectileContact?.(c, target, skill))
            c.strike(target, hit, skill);
        },
      );
    this.#fields.step(this.tick, this.#contexts);
    this.#hits.resolve(this.tick);
    // Release at the end of the charge tick, from the caster's current position.
    // The first flight step always belongs to the next tick, even when other bolts are in flight.
    for (const [slot, shot] of this.#charging) {
      const caster = this.#runners[slot]!;
      if (caster.respawn || actionLocked(caster)) this.#cancelCharge(slot);
      else if (this.tick >= shot.release) {
        this.#projectiles.launch(caster, shot.skill, shot.direction, shot.attack, RAID_HZ);
        this.#charging.delete(slot);
      }
    }
    for (const r of this.#runners) {
      // A remembered target belongs to this life, even if the same slot later respawns.
      if (r.respawn || (typeof r.lastStrike === 'number' && this.#runners[r.lastStrike]!.respawn))
        r.lastStrike = null;
      if (r.respawn || (r.lastWard !== null && this.#runners[r.lastWard]!.respawn))
        r.lastWard = null;
      this.#heroes[r.slot]!.events.onTickEnd?.(this.#contexts[r.slot]!);
    }
    for (const team of [0, 1] as const) {
      const call = this.#calls[team];
      if (
        call &&
        (call.until <= this.tick ||
          ('target' in call &&
            typeof call.target === 'number' &&
            this.#runners[call.target]!.respawn))
      )
        this.#calls[team] = null;
    }
    const [blue, red] = this.#hits.damage;
    // Read the settled tick. A tie preserves the last outright lead, including on the final tick.
    if (blue !== red) {
      const leader = blue > red ? 0 : 1;
      if (this.#lastLeader !== null && leader !== this.#lastLeader) this.#leadChanges++;
      this.#lastLeader = leader;
    }
    if (Math.max(blue, red) >= WAGON_HP || this.#tick >= ROUND_TICKS) {
      const destroyed = Math.max(blue, red) >= WAGON_HP;
      const draw = blue === red || (blue >= WAGON_HP && red >= WAGON_HP);
      this.#result = {
        reason: destroyed ? 'destruction' : 'time',
        winner: draw ? 'draw' : blue > red ? 0 : 1,
      };
    }
  }
}
