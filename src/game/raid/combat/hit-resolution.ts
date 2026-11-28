import { raidRageGain } from '../../../content/raid/rage.ts';
import type { HeroCombat, HeroEvents, Hit } from '../heroes/hero-definition.ts';
import { RAID_HZ, RAID_RUN_LIMIT_X, raidRespawnTicks, WAGON_HP } from '../raid-rules.ts';
import { wagonCenter } from '../wagon.ts';
import { limitRaidPlacement, raidRunnerHeight } from '../runner-motion.ts';
import type { RaidHealthChange, RaidRunner, RaidTarget, Runner } from '../raid-view.ts';
import { applyCrowdControl } from '../raid-control.ts';
export function raidBossBonusPercent(runners: readonly RaidRunner[], attackingTeam: number) {
  return (
    15 * runners.filter((runner) => runner.team !== attackingTeam && runner.respawn > 0).length
  );
}

function chargeRageFromDamage(runner: Runner, damage: number) {
  const rage = runner.rage + raidRageGain(runner.hero, damage, runner.rageLoadout);
  // Many small hits must fill the meter at the same HP threshold as a single hit.
  runner.rage = rage >= 100 - 1e-9 ? 100 : rage;
}

/** Owns the damage ledger and resolves queued hits in insertion order, including parries. */
export class RaidHitResolution {
  readonly damage: [number, number] = [0, 0];
  readonly #changes: RaidHealthChange[] = [];
  get healthChanges(): readonly RaidHealthChange[] {
    return this.#changes;
  }
  readonly #hits: Hit[] = [];
  readonly #contributors: Array<Map<number, number>>;
  private readonly contexts: readonly HeroCombat[];
  private readonly events: (slot: number) => HeroEvents;
  private readonly resetHero: (slot: number) => void;
  constructor(
    contexts: readonly HeroCombat[],
    events: (slot: number) => HeroEvents,
    resetHero: (slot: number) => void,
  ) {
    this.contexts = contexts;
    this.events = events;
    this.resetHero = resetHero;
    this.#contributors = contexts.map(() => new Map());
  }
  enqueue(hit: Hit) {
    this.#hits.push(hit);
  }
  #record(tick: number, from: number | null, target: RaidTarget, amount: number) {
    if (!amount) return;
    const runner = target === 'wagon' ? undefined : this.contexts[target]!.self;
    const { x, z } = runner ?? wagonCenter(tick);
    this.#changes.push({
      tick,
      from,
      target,
      amount,
      x,
      z,
      elevation: runner ? raidRunnerHeight(runner) : 0,
    });
  }
  heal(tick: number, from: Runner, target: number, amount: number) {
    const { self, stats } = this.contexts[target]!;
    const healed = Math.min(amount, stats.hp - self.hp);
    self.hp += healed;
    this.#record(tick, from.slot, target, healed);
  }
  resolve(tick: number) {
    while (this.#changes.length && tick - this.#changes[0]!.tick >= RAID_HZ) this.#changes.shift();
    if (!this.#hits.length) return;
    // Hits land simultaneously. A knockout in this batch affects hits from the next tick.
    const runners = this.contexts.map((c) => c.self);
    const bonuses = [raidBossBonusPercent(runners, 0), raidBossBonusPercent(runners, 1)] as const;
    for (const hit of this.#hits) {
      const attacker = hit.from === null ? undefined : this.contexts[hit.from]?.self;
      const victim = hit.target === 'wagon' ? undefined : this.contexts[hit.target]?.self;
      const source = attacker && this.contexts[attacker.slot];
      const outgoing = attacker && this.events(attacker.slot);
      if (victim) {
        if (victim.respawn) continue;
        const blocked = this.events(victim.slot).onIncomingHit?.(this.contexts[victim.slot]!, hit);
        if (blocked) {
          if (blocked !== true) chargeRageFromDamage(victim, hit.amount * blocked.rageMultiplier);
          continue;
        }
      }
      const base =
        source && outgoing?.onOutgoingHit
          ? outgoing.onOutgoingHit(source, hit, victim)
          : hit.amount;
      if (hit.target === 'wagon') {
        if (attacker) {
          const boosted = Math.round((base * (100 + bonuses[attacker.team])) / 100);
          const damage = Math.min(boosted, WAGON_HP - this.damage[attacker.team]);
          this.damage[attacker.team] += damage;
          attacker.wagonDamage += damage;
          this.#record(tick, attacker.slot, hit.target, -damage);
          if (hit.designated && damage > 0) attacker.lastStrike = 'wagon';
        }
        continue;
      }
      if (!victim) continue;
      let remaining = this.events(victim.slot).onIncomingDamage?.(base) ?? base;
      if (!hit.rule?.piercesShield) {
        if (victim.shield) remaining = Math.ceil(remaining / 2);
        if (victim.barrier) {
          const absorbed = Math.min(remaining, victim.barrier.amount);
          victim.barrier.amount -= absorbed;
          remaining -= absorbed;
          if (!victim.barrier.amount) victim.barrier = null;
        }
      }
      const damage = Math.min(victim.hp, remaining);
      victim.hp -= damage;
      this.#record(tick, hit.from, hit.target, -damage);
      if (attacker && hit.designated && damage > 0) attacker.lastStrike = victim.slot;
      chargeRageFromDamage(victim, damage);
      const contributors = this.#contributors[victim.slot]!;
      if (attacker) {
        contributors.set(attacker.slot, tick);
        if (hit.rule && !this.contexts[victim.slot]!.controlImmune()) {
          if (hit.rule.blindTicks)
            victim.blindUntil = Math.max(victim.blindUntil, tick + hit.rule.blindTicks);
          if (hit.rule.control) applyCrowdControl(victim, hit.rule.control);
          if (hit.rule.tauntTicks)
            victim.taunt = { from: attacker.slot, until: tick + hit.rule.tauntTicks };
          if (hit.rule.launchTicks || hit.rule.displacement) {
            victim.dash = victim.leap = null;
            if (hit.rule.launchTicks) {
              victim.air = null;
              victim.jumping = victim.launchDuration = hit.rule.launchTicks;
            } else {
              const origin = hit.rule.displacementOrigin ?? attacker;
              const dx = victim.x - origin.x;
              const dz = victim.z - origin.z;
              const separation = Math.hypot(dx, dz);
              const push = hit.rule.displacement === 'push';
              const reach = push ? separation + 2.5 : Math.min(1, separation);
              const to = limitRaidPlacement({
                x: origin.x + (separation ? dx / separation : 0) * reach,
                z: origin.z + (separation ? dz / separation : 1) * reach,
              });
              victim.x = Math.min(RAID_RUN_LIMIT_X, Math.max(-RAID_RUN_LIMIT_X, to.x));
              victim.z = to.z;
            }
          }
        }
        outgoing?.onDamageDealt?.(this.contexts[attacker.slot]!, hit, victim, damage);
      }
      if (victim.hp === 0) {
        if (attacker) {
          attacker.kills++;
          for (const [slot, lastHitTick] of contributors)
            if (slot !== attacker.slot && tick - lastHitTick <= 5 * RAID_HZ)
              this.contexts[slot]!.self.assists++;
        }
        contributors.clear();
        victim.deaths++;
        victim.silenced = 0;
        victim.slows.length = 0;
        victim.stunned = victim.launchDuration = 0;
        victim.staggered = victim.staggerGuard = 0;
        victim.hasteTicks = 0;
        victim.blindUntil = victim.controlGuardUntil = 0;
        victim.respawn = raidRespawnTicks(victim.deaths);
        victim.jumping = 0;
        victim.air = null;
        victim.barrier = null;
        victim.taunt = null;
        victim.leap = null;
        victim.dash = null;
        this.resetHero(victim.slot);
        victim.spin = null;
        victim.side = 0;
        victim.brake = 0;
        victim.appliedBrake = 0;
      }
    }
    this.#hits.length = 0;
  }
}
