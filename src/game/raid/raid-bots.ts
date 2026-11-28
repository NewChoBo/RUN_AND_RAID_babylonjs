import { actionLocked } from './raid-control.ts';
import { RAID_RUN_LIMIT_X } from './raid-rules.ts';
import { wagonCenter, wagonContact } from './wagon.ts';
import { RAID_COUNTERS, RAID_ELECTRIC_GRID, type RaidCounter } from './raid-boss.ts';
import {
  limitRaidPlacement,
  raidGroundPointAfter,
  raidRunnerPositionAfter,
} from './runner-motion.ts';
import { canUseRaidSkill, raidSkill } from './heroes/hero-catalog.ts';
import {
  HEROES,
  RAID_HZ,
  RAID_LEAP_TICKS,
  raidBossBonusPercent,
  raidAimKind,
  raidRoadTravel,
  WAGON_HP,
  type Skill,
  type RaidPoint,
  type RaidMatch,
  type RaidRunner,
} from './raid-match.ts';
import type { RaidOrder } from './raid-feature.ts';

const soloSlot = new Set([0]);

// Consider the whole impact window: the road can carry an already live tile under the runner.
function approachingCell(counter: RaidCounter, r: RaidRunner, goalX: number) {
  const { width, depth } = RAID_ELECTRIC_GRID;
  for (const cell of counter.cells) {
    const begin = cell.phase === 'impact' ? 0 : cell.ticks;
    const end =
      begin + (cell.phase === 'impact' ? cell.ticks : RAID_COUNTERS[counter.kind].active) - 1;
    const near = raidRunnerPositionAfter(r, begin).z - cell.z + raidRoadTravel(begin);
    const far = raidRunnerPositionAfter(r, end).z - cell.z + raidRoadTravel(end);
    if (Math.max(near, far) < -depth / 2 || Math.min(near, far) >= depth / 2) continue;
    // Keep a safe flank until the original formation position is clear as well.
    if (Math.min(r.x, goalX) < cell.x + width / 2 && Math.max(r.x, goalX) >= cell.x - width / 2) {
      return { cell, arrival: begin };
    }
  }
}

/** Bots see the same positions, danger warning and target availability as a local player. */
export function driveRaidBots(
  view: Pick<
    RaidMatch,
    'runners' | 'damage' | 'tick' | 'hazard' | 'calls' | 'canTarget' | 'canShield' | 'skillRange'
  >,
  send: RaidOrder,
  humanSlots: ReadonlySet<number> = soloSlot,
) {
  for (const r of view.runners) {
    if (humanSlots.has(r.slot)) continue;
    // Mirror the two formation positions across teams. Both teams open on the objective.
    const rank = r.slot % 2;
    if (r.respawn || (view.tick + rank * 4) % 8 !== 0) continue;
    let nearest: RaidRunner | undefined;
    let nearestDistance = Infinity;
    for (const other of view.runners) {
      if (!view.canTarget(r.slot, other.slot)) continue;
      const distance = Math.hypot(other.x - r.x, other.z - r.z);
      if (distance < nearestDistance) {
        nearest = other;
        nearestDistance = distance;
      }
    }
    const phase = Math.floor(view.tick / (8 * RAID_HZ)) % 3;
    const duel =
      nearest && (nearest.hp < 32 || (phase === 1 && rank === 1) || (phase === 2 && rank === 0));
    // A team trailing by a fifth of the boss's health returns to the scoring objective.
    const behind = view.damage[1 - r.team]! - view.damage[r.team]! > WAGON_HP * 0.2;
    const call = view.calls[r.team];
    const target =
      call && 'target' in call && view.canTarget(r.slot, call.target)
        ? call.target === 'wagon'
          ? undefined
          : view.runners[call.target]
        : duel && !behind && !raidBossBonusPercent(view.runners, r.team)
          ? nearest
          : undefined;
    const partner = view.runners.find((other) => other.team === r.team && other.slot !== r.slot)!;
    // Keep the team's preferred lane while it faces the hull. Follow the near wheel when it passes.
    const formationX = (r.team === 0 ? -1 : 1) * (rank ? 1.8 : 0.65);
    const carriage = wagonCenter(view.tick);
    let goalX = target?.x ?? wagonContact({ x: formationX, z: r.z }, view.tick).x;
    const counter = view.hazard;
    const threat = counter && approachingCell(counter, r, goalX);
    const danger = threat?.cell;
    const arrival = threat?.arrival ?? Infinity;
    if (counter?.kind === 'pillar' && danger) {
      const row = counter.cells.filter((cell) => cell.row === danger.row);
      const margin = RAID_ELECTRIC_GRID.width / 2 + 0.65;
      const left = row[0]!.x - margin;
      const right = row[row.length - 1]!.x + margin;
      goalX =
        left < -RAID_RUN_LIMIT_X || (right <= RAID_RUN_LIMIT_X && right - r.x < r.x - left)
          ? right
          : left;
    }
    // Ranged runners need their duel target in front of them to land a basic attack.
    const keepDistance =
      target && HEROES[r.hero].reach >= 8 && target.z - r.z <= Math.abs(target.x - r.x);
    send(r.slot, 'move', {
      side: Math.abs(goalX - r.x) < 0.5 ? 0 : Math.sign(goalX - r.x),
      brake:
        call && 'movement' in call
          ? Number(call.movement === 'retreat')
          : keepDistance
            ? 0.4
            : Number(!target && partner.respawn > 0 && r.hp < 40 && r.z > 0),
    });
    const evade = counter?.kind === 'low' && arrival <= 16;
    if (evade) send(r.slot, 'jump', r.jetFuel !== undefined ? true : undefined);
    else if (r.air?.thrust) send(r.slot, 'jump', false);
    send(r.slot, 'lock', target?.slot ?? 'wagon');
    // Space casts just over a second apart. Steering and hazard reactions still run every eight ticks.
    if (actionLocked(r) || r.silenced || view.tick < RAID_HZ || (view.tick + rank * 20) % 32 !== 0)
      continue;
    const point = target ?? wagonContact(r, view.tick);
    const openingSkill = raidSkill(r.hero, 0);
    const opener = openingSkill.kind;
    const needsHealing =
      opener === 'ward' &&
      (r.hp <= HEROES[r.hero].hp - 15 ||
        (partner.hp <= HEROES[partner.hero].hp - 15 && view.canShield(r.slot, partner.slot)));
    const distance = Math.hypot(point.x - r.x, point.z - r.z);
    // The marker is a road tile. Lead the moving formation by the road travel during the jump.
    const leapTarget = target ?? wagonContact(r, view.tick + RAID_LEAP_TICKS);
    const leapAim = limitRaidPlacement(
      {
        x: leapTarget.x,
        z: leapTarget.z + raidRoadTravel(RAID_LEAP_TICKS),
      },
      RAID_LEAP_TICKS,
    );
    const landing = raidGroundPointAfter(leapAim, RAID_LEAP_TICKS);
    const landingGap = Math.hypot(leapTarget.x - landing.x, leapTarget.z - landing.z);
    const leap = raidSkill(r.hero, 1);
    const canLeap =
      leap.kind === 'leap' &&
      !r.jumping &&
      (landingGap <= view.skillRange(r.slot, 1).radius || landingGap < distance) &&
      Math.hypot(leapAim.x - r.x, leapAim.z - r.z) <= leap.range;
    const pulse = view.skillRange(r.slot, 0);
    const orb = r.lastWard === partner.slot && !partner.respawn ? partner : r;
    const orbTarget = target ?? wagonContact(orb, view.tick);
    const partnerTarget = target ?? wagonContact(partner, view.tick);
    const orbGap = Math.hypot(orbTarget.x - orb.x, orbTarget.z - orb.z);
    const partnerGap = Math.hypot(partnerTarget.x - partner.x, partnerTarget.z - partner.z);
    const passOrb =
      r.hero === 'jade' && view.canShield(r.slot, partner.slot) && partnerGap + 2 < distance;
    const repositionOrb =
      r.hero === 'jade' && orbGap > 6 && (distance <= 6 || (passOrb && partnerGap <= 6));
    const usePulse = r.heroView.turrets
      ? distance <= pulse.range + pulse.radius
      : opener === 'ward'
        ? needsHealing || repositionOrb
        : distance <= pulse.range;
    const needsEvasion =
      !!nearest && nearestDistance < 4 && (r.hp < HEROES[r.hero].hp * 0.55 || !!danger);
    const canFlyBy = r.hero !== 'longshot' || needsEvasion || (!!target && distance <= 7);
    const canDischarge = r.hero !== 'jade' || orbGap <= 6;
    const inSlamRange = leap.kind !== 'leap' || distance <= HEROES[r.hero].radius;
    const wounded = [r, partner]
      .filter((ally) => ally.hp <= HEROES[ally.hero].hp - 15 && view.canShield(r.slot, ally.slot))
      .sort((a, b) => a.hp / HEROES[a.hero].hp - b.hp / HEROES[b.hero].hp)[0];
    const supportSkill =
      wounded &&
      ([1, 2] as const).find((slot) => {
        const rule = raidSkill(r.hero, slot);
        return (
          canUseRaidSkill(r, slot) &&
          rule.kind === 'target' &&
          (rule.allyEffect === 'heal' ||
            (rule.allyEffect === 'barrier' &&
              !wounded.barrier &&
              wounded.hp < HEROES[wounded.hero].hp * 0.65))
        );
      });
    let skill: Skill;
    if (supportSkill !== undefined && wounded) {
      send(r.slot, 'cast', { skill: supportSkill, target: wounded.slot });
      continue;
    }
    const ultimate = raidSkill(r.hero, 3).attack;
    const windup = ultimate.kind === 'projectile' && ultimate.windupTicks;
    const unsafeCharge = windup && (needsEvasion || arrival <= windup);
    const turretInRange =
      !r.heroView.turrets ||
      r.heroView.turrets.some((t) =>
        [
          wagonContact(t, view.tick),
          ...view.runners.filter((enemy) => enemy.team !== r.team && !enemy.respawn),
        ].some((enemy) => Math.hypot(enemy.x - t.x, enemy.z - t.z) <= 6),
      );
    if (
      turretInRange &&
      !unsafeCharge &&
      canUseRaidSkill(r, 3) &&
      (r.hero !== 'jade' || orbGap <= 8)
    )
      skill = 3;
    else if (canLeap && canUseRaidSkill(r, 1) && distance > HEROES[r.hero].radius) skill = 1;
    else if (r.heroView.iceCrystals !== undefined && nearestDistance <= 8 && canUseRaidSkill(r, 2))
      skill = 2;
    else if (
      r.heroView.iceCrystals !== undefined &&
      r.heroView.iceCrystals < 5 &&
      distance <= 6 &&
      canUseRaidSkill(r, 1)
    )
      skill = 1;
    else if (r.hero === 'longshot' && canUseRaidSkill(r, 2) && distance <= 3 && !needsEvasion)
      skill = 2;
    else if (usePulse && canUseRaidSkill(r, 0)) skill = 0;
    else if (canDischarge && (leap.kind !== 'leap' || canLeap) && canUseRaidSkill(r, 1)) skill = 1;
    else if (
      canFlyBy &&
      inSlamRange &&
      (canUseRaidSkill(r, 2) || (raidSkill(r.hero, 2).requiresJump && !r.cooldowns[2]))
    )
      skill = 2;
    else continue;
    if (raidSkill(r.hero, skill).requiresJump && !r.jumping) send(r.slot, 'jump');
    const kind = raidAimKind(r.hero, skill);
    if (kind === 'leap') send(r.slot, 'cast', { skill, ...leapAim });
    else if (kind === 'field') {
      const { range, radius } = view.skillRange(r.slot, skill);
      const attack = raidSkill(r.hero, skill).attack;
      // Put a damaging field on the road the wagon will occupy at its first pulse.
      const lead =
        attack.kind === 'field' && attack.pulse?.effect.kind === 'damageEnemies'
          ? attack.pulse.intervalTicks
          : 0;
      const ahead = raidRoadTravel(lead);
      const aim = target ?? {
        x: wagonCenter(view.tick + lead).x,
        z: carriage.z + (attack.kind === 'field' && attack.hit ? Math.min(ahead, radius) : ahead),
      };
      const gap = Math.hypot(aim.x - r.x, aim.z - r.z);
      const factor = gap > range ? range / gap : 1;
      send(r.slot, 'cast', {
        skill,
        x: r.x + (aim.x - r.x) * factor,
        z: r.z + (aim.z - r.z) * factor,
      });
    } else if (
      kind === 'direction' &&
      r.hero === 'longshot' &&
      skill === 2 &&
      needsEvasion &&
      nearest
    )
      send(r.slot, 'cast', {
        skill,
        dx: r.x - nearest.x || (r.team ? 1 : -1),
        dz: r.z - nearest.z,
      });
    else if (kind === 'direction') {
      const attack = raidSkill(r.hero, skill).attack;
      let origin: RaidPoint = r,
        aim: RaidPoint = target ?? carriage;
      if (attack.kind === 'projectile' && attack.windupTicks) {
        origin = raidRunnerPositionAfter(r, attack.windupTicks);
        // The bot stops steering once it reaches its chosen lane during the draw.
        origin.x = Math.max(Math.min(goalX, r.x), Math.min(origin.x, Math.max(goalX, r.x)));
        const lead = attack.windupTicks + (distance / attack.flight.speed) * RAID_HZ;
        aim = target ? raidRunnerPositionAfter(target, lead) : wagonCenter(view.tick + lead);
      }
      send(r.slot, 'cast', { skill, dx: aim.x - origin.x, dz: aim.z - origin.z });
    } else if (kind === 'ward') {
      const healPartner =
        view.canShield(r.slot, partner.slot) &&
        partner.hp / HEROES[partner.hero].hp < r.hp / HEROES[r.hero].hp;
      send(r.slot, 'cast', {
        skill,
        ally: (repositionOrb ? passOrb : healPartner) ? partner.slot : r.slot,
      });
    } else if (kind === 'pulse') send(r.slot, 'cast', { skill });
    else send(r.slot, 'cast', { skill, target: target?.slot ?? 'wagon' });
  }
}
