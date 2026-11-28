import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSlow, applyCrowdControl, slow } from '../../src/game/raid/raid-control.ts';
import {
  RaidBoss,
  RAID_COUNTERS,
  RAID_ELECTRIC_GRID,
  inElectricCell,
  raidElectricRowZ,
} from '../../src/game/raid/raid-boss.ts';
import {
  RaidMatch,
  RAID_HZ,
  ROUND_TICKS,
  canUseRaidSkill,
  raidRunnerPositionAfter,
} from '../../src/game/raid/raid-match.ts';
import { RaidRound } from '../../src/game/raid/raid-round.ts';
import { driveRaidBots } from '../../src/game/raid/raid-bots.ts';
import { RAID_FRONT_Z } from '../../src/game/raid/runner-motion.ts';
import { wagonCenter } from '../../src/game/raid/wagon.ts';

test('low electricity warns each road cell before striking, reaches rear runners later and only hits grounded runners once', () => {
  const boss = new RaidBoss();
  const runners = [8.4, 0, 0, -40, 0].map((z, slot) => ({
    slot,
    x: slot === 4 ? 3.6 : 0,
    z,
    respawn: 0,
  }));
  const hits = [];
  let first;
  for (let tick = 60; tick < 204; tick++) {
    boss.step(
      tick,
      runners,
      (r) => (r.slot === 2 ? 1.2 : 0),
      (slot, damage) => hits.push({ slot, tick, damage }),
    );
    const hazard = boss.counter;
    if (tick === 60) {
      assert.equal(hazard.kind, 'low');
      assert.equal(hazard.startedAt, tick);
      assert.equal(hazard.zigzag, false);
      assert.equal(hazard.cells.length, 1);
      [first] = hazard.cells;
      assert.equal(first.ticks, RAID_COUNTERS.low.windup);
    }
    if (tick < 60 + RAID_COUNTERS.low.windup) assert.deepEqual(hits, []);
    if (hazard) {
      assert.ok(
        hazard.cells.every((c) => c.x === first.x && c.z === raidElectricRowZ(c.row, tick)),
      );
      const leading = hazard.cells.find((c) => c.row === first.row);
      if (leading)
        assert.equal(leading.phase, tick < 60 + RAID_COUNTERS.low.windup ? 'warning' : 'impact');
    }
  }
  assert.deepEqual(
    hits.map((h) => h.slot),
    [0, 1, 3],
  );
  assert.ok(hits.every((h) => h.damage === RAID_COUNTERS.low.damage));
  assert.ok(hits[0].tick < hits[1].tick && hits[1].tick < hits[2].tick);
  assert.equal(first.phase, 'warning'); // A saved frame is never mutated by the next tick.
  assert.equal(boss.counter, null);
});

test('lightning pillars leave a safe flank and can hit airborne runners after the warning', () => {
  const boss = new RaidBoss();
  const runners = [0, 1, 2, 3].map((slot) => ({ slot, x: 0, z: 0, respawn: slot === 3 ? 30 : 0 }));
  const hits = [];
  for (let tick = 204; tick < 348; tick++) {
    boss.step(
      tick,
      runners,
      () => 2.5,
      (slot, damage, stunTicks) => hits.push([slot, damage, stunTicks]),
    );
    if (tick === 204) {
      assert.equal(boss.counter.kind, 'pillar');
      assert.deepEqual(
        boss.counter.cells.map((c) => c.column),
        [0, 1, 2],
      );
      runners[1].x = 6.6;
      runners[2].x = -6.6;
    }
    if (tick < 204 + RAID_COUNTERS.pillar.windup) assert.deepEqual(hits, []);
  }
  assert.deepEqual(hits, [
    [0, RAID_COUNTERS.pillar.damage, RAID_COUNTERS.pillar.stunTicks],
    [2, RAID_COUNTERS.pillar.damage, RAID_COUNTERS.pillar.stunTicks],
  ]);
  assert.equal(boss.counter, null);
});

test('neighboring cells share one edge and scroll with their road tile', () => {
  const center = { x: 0, z: 0 },
    edge = RAID_ELECTRIC_GRID.width / 2;
  const right = { x: 2 * edge, z: 0 };
  assert.equal(inElectricCell(center, { x: edge, z: 0 }), false);
  assert.equal(inElectricCell(right, { x: edge, z: 0 }), true);
  assert.equal(inElectricCell(center, { x: 0, z: edge }), false);
  assert.equal(inElectricCell(center, { x: 0, z: -edge }), true);
  assert.equal(raidElectricRowZ(0, 15), raidElectricRowZ(0, 0) - 3);
});

test('all four runner slots take turns drawing low electricity and each bank width appears on both flanks', () => {
  const boss = new RaidBoss();
  const runners = [-6.6, -3.6, 3.6, 6.6].map((x, slot) => ({ slot, x, z: 0, respawn: 0 }));
  const low = [],
    pillar = [];
  for (let turn = 0; turn < 8; turn++) {
    boss.step(
      60 + 144 * turn,
      runners,
      () => 0,
      () => {},
    );
    const cells = boss.counter.cells.map((c) => c.column);
    if (boss.counter.kind === 'low') low.push(...cells);
    else pillar.push(cells);
  }
  assert.deepEqual(low, [0, 1, 3, 4]);
  assert.deepEqual(pillar, [
    [0, 1, 2],
    [3, 4],
    [0, 1],
    [2, 3, 4],
  ]);
  runners[0].respawn = 100;
  boss.step(
    60 + 8 * 144,
    runners,
    () => 0,
    () => {},
  );
  assert.notEqual(boss.counter.cells[0].column, 0);
});

test('a bot jumps the low tile, holds the open flank through the pillars, then returns to its attack position', () => {
  const match = new RaidMatch(['longshot', 'hammer', 'rime', 'jade']);
  const bot = match.runners[1],
    humans = new Set([0, 2, 3]);
  for (const r of match.runners) r.basic = 9999;
  match.runners[2].respawn = match.runners[3].respawn = 9999;
  match.runners[0].x = bot.x = 0;
  bot.z = RAID_FRONT_Z;
  const hp = bot.hp;
  let jumpedOverTile = false,
    dodgedPillars = false;
  while (match.tick < 330) {
    driveRaidBots(
      match,
      (slot, action, payload) => {
        if (action === 'move') match.move(slot, payload.side, payload.brake);
        if (action === 'jump') match.jump(slot, payload);
      },
      humans,
    );
    match.step();
    const hazard = match.hazard;
    const active = hazard?.cells.filter((c) => c.phase === 'impact') ?? [];
    if (hazard?.kind === 'low' && active.some((c) => inElectricCell(c, bot))) {
      assert.ok(bot.jumping);
      jumpedOverTile = true;
    }
    if (hazard?.kind === 'pillar' && active.some((c) => inElectricCell(c, { x: 0, z: bot.z }))) {
      assert.ok(bot.x >= RAID_ELECTRIC_GRID.width / 2);
      assert.equal(bot.jumping, 0);
      dodgedPillars = true;
    }
  }
  assert.ok(jumpedOverTile && dodgedPillars);
  assert.equal(bot.hp, hp);
  const flank = bot.x - wagonCenter(match.tick).x;
  assert.ok(flank < 0 && Math.abs(flank) < RAID_ELECTRIC_GRID.width / 2);
});

test('late discharges progress row by row and reverse horizontally at both edges', () => {
  const firstLate = 60 + Math.ceil((ROUND_TICKS / 2 - 60) / 144) * 144;
  for (const start of [firstLate, firstLate + 144]) {
    const boss = new RaidBoss();
    const rows = new Map();
    for (let tick = start; tick < start + 144; tick++) {
      boss.step(
        tick,
        [{ slot: 0, x: 0, z: 0, respawn: 0 }],
        () => 0,
        () => {},
      );
      if (!boss.counter) continue;
      assert.ok(boss.counter.zigzag);
      const active = boss.counter.cells.filter((c) => c.phase === 'impact');
      for (const cell of active) {
        if (!rows.has(cell.row))
          rows.set(
            cell.row,
            active.filter((c) => c.row === cell.row).map((c) => c.column),
          );
      }
    }
    const indices = [...rows.keys()],
      path = [...rows.values()];
    assert.ok(indices.length > 8);
    assert.ok(indices.slice(1).every((row, i) => row === indices[i] - 1));
    assert.ok(path.every((cols) => cols.length >= 1 && cols.length < RAID_ELECTRIC_GRID.columns));
    assert.ok(path.some((cols) => cols.includes(0)) && path.some((cols) => cols.includes(4)));
    const steps = path.slice(1).map((cols, i) => cols[0] - path[i][0]);
    assert.ok(steps.every((step) => Math.abs(step) === 1));
    assert.ok(steps.filter((step, i) => i && step !== steps[i - 1]).length >= 2);
  }
});

function beforeFirstLowImpact(hero) {
  const match = new RaidMatch(hero);
  const [runner] = match.runners;
  for (const r of match.runners)
    Object.assign(r, {
      x: r.slot ? 6 : 0,
      z: RAID_FRONT_Z,
      basic: 1000,
      brake: 0.4,
      appliedBrake: 0.4,
    });
  while (!match.hazard) match.step();
  const impactTick = match.hazard.startedAt + RAID_COUNTERS.low.windup;
  while (match.tick < impactTick - 1) match.step();
  assert.equal(runner.stunned, 0);
  return { match, runner, hp: runner.hp };
}

test('one electric contact deals damage and stuns for exactly the configured ticks before held movement resumes', () => {
  const { match, runner, hp } = beforeFirstLowImpact('hammer');
  const { damage, stunTicks } = RAID_COUNTERS.low;
  match.step();
  assert.equal(runner.hp, hp - damage);
  assert.equal(runner.stunned, 0.6 * RAID_HZ);
  assert.ok(match.move(runner.slot, 1, 0));
  const x = runner.x;
  for (let remaining = stunTicks; remaining > 0; remaining--) {
    assert.equal(runner.stunned, remaining);
    assert.equal(match.cast(runner.slot, 0), false);
    assert.equal(match.jump(runner.slot), false);
    match.step();
    assert.equal(runner.x, x);
    assert.equal(runner.hp, hp - damage);
  }
  assert.equal(runner.stunned, 0);
  assert.ok(match.cast(runner.slot, 0));
  match.step();
  assert.ok(runner.x > x);
});

test('a counter blocks the electric hit, Whirlwind resists its stun and a damage barrier only absorbs its damage', () => {
  const guarded = beforeFirstLowImpact('rildin');
  assert.ok(guarded.match.cast(0, 1));
  guarded.match.step();
  assert.equal(guarded.runner.hp, guarded.hp);
  assert.equal(guarded.runner.stunned, 0);
  assert.equal(guarded.runner.heroView.guardUntil, 0);

  const spinning = beforeFirstLowImpact('hammer');
  assert.ok(spinning.match.cast(0, 2));
  spinning.match.step();
  assert.equal(spinning.runner.hp, spinning.hp - RAID_COUNTERS.low.damage);
  assert.equal(spinning.runner.stunned, 0);
  assert.ok(spinning.runner.spinTicks > 0);

  const protectedRunner = beforeFirstLowImpact('hammer');
  protectedRunner.runner.barrier = {
    amount: RAID_COUNTERS.low.damage,
    until: protectedRunner.match.tick + 2,
  };
  protectedRunner.match.step();
  assert.equal(protectedRunner.runner.barrier, null);
  assert.equal(protectedRunner.runner.hp, protectedRunner.hp);
  assert.equal(protectedRunner.runner.stunned, RAID_COUNTERS.low.stunTicks);
});

test('respawn protection halves electric damage and a shorter discharge cannot replace a longer stun', () => {
  const { damage, stunTicks } = RAID_COUNTERS.low;
  for (const previousStun of [0, stunTicks + 8]) {
    const { match, runner, hp } = beforeFirstLowImpact('hammer');
    runner.shield = 45;
    runner.stunned = previousStun;
    match.step();
    assert.equal(runner.hp, hp - Math.ceil(damage / 2));
    assert.equal(runner.stunned, Math.max(previousStun - 1, stunTicks));
  }
});

test('stagger holds steering and basic attacks, denies jumps and casts, then restores held movement while a subsequent stun bypasses stagger recovery', () => {
  const match = new RaidMatch(['bastion', 'theresa', 'rime', 'jade']);
  const [bastion, theresa, victim] = match.runners;
  Object.assign(theresa, { x: 0, z: 0 });
  for (const runner of match.runners) runner.basic = 100;
  assert.ok(match.cast(bastion.slot, 0));
  match.step();
  const { x, z } = victim;
  assert.equal(victim.staggered, 12);
  assert.equal(theresa.staggered, 0);
  assert.equal(match.jump(victim.slot), false);
  assert.equal(canUseRaidSkill(victim, 0), false);
  assert.equal(match.cast(victim.slot, 0), false);
  assert.equal(victim.cooldowns[0], 0);
  assert.ok(match.move(victim.slot, 1, 0));
  assert.deepEqual(raidRunnerPositionAfter(victim, 0.9), { x, z });
  victim.basic = 0;
  for (let i = 0; i < 12; i++) match.step();
  assert.deepEqual({ x: victim.x, z: victim.z }, { x, z });
  assert.equal(victim.basic, 0);
  assert.equal(victim.staggered, 0);
  assert.ok(match.jump(victim.slot));
  theresa.x = victim.x;
  theresa.z = victim.z - 2;
  assert.ok(match.cast(theresa.slot, 1, victim.slot));
  assert.equal(victim.stunned, 0);
  while (theresa.dash) match.step();
  assert.equal(victim.staggered, 0);
  assert.ok(victim.hp < 98 && victim.x > x && victim.basic > 0);
  assert.equal(victim.stunned, 23);
  assert.equal(canUseRaidSkill(victim, 0), false);
});

test('frost slows opponents without blocking casts; a shorter frost hit preserves the longer slow', () => {
  const match = new RaidMatch(['rime', 'hammer', 'bastion', 'jade']);
  const [rime, ally, victim] = match.runners;
  rime.rage = 100;
  assert.ok(match.cast(0, 3, 2));
  match.step();
  assert.equal(victim.slowed, 90);
  assert.ok(match.cast(0, 0));
  assert.ok(match.move(2, 1, 0));
  const x = victim.x;
  match.step();
  assert.equal(victim.slowed, 89);
  assert.ok(Math.abs(victim.x - x - (4.8 / 30) * 0.55) < 1e-8);
  assert.equal(ally.slowed, 0);
  assert.ok(match.cast(2, 0));
  for (let i = 0; i < 89; i++) match.step();
  assert.equal(victim.slowed, 0);
});

test('four-player replay reproduces contact stuns from both discharges and late zigzags alongside PvP stagger', () => {
  const seats = ['bastion', 'rime', 'jade', 'hammer'].map((hero, i) => ({ hero, actor: i + 1 }));
  const host = new RaidRound(seats),
    guest = new RaidRound(seats);
  assert.ok(host.enqueue(1, { seq: 1, action: 'cast', payload: { skill: 0 } }));
  const impacts = new Set();
  for (let i = 0; i < ROUND_TICKS / 2 + 320; i++) {
    const frames = host.advance(1);
    assert.ok(guest.replay(JSON.parse(JSON.stringify(frames))));
    if (i === 0) assert.equal(guest.match.runners[2].staggered, 12);
    assert.deepEqual(guest.match.hazard, host.match.hazard);
    assert.deepEqual(guest.match.runners, host.match.runners);
    const hazard = guest.match.hazard;
    if (!hazard) continue;
    for (const hit of guest.match.healthChanges) {
      if (hit.tick !== guest.match.tick || hit.from !== null || hit.amount >= 0) continue;
      const victim = guest.match.runners[hit.target];
      if (victim.respawn) continue;
      assert.equal(victim.stunned, 0.6 * RAID_HZ);
      impacts.add(hazard.kind + (hazard.zigzag ? '-zigzag' : ''));
    }
  }
  assert.deepEqual(impacts, new Set(['low', 'pillar', 'low-zigzag', 'pillar-zigzag']));
});

test('each slow has its own expiry and only the strongest active slow changes steering', () => {
  for (const order of [
    [slow(10, 20), slow(4, 50)],
    [slow(4, 50), slow(10, 20)],
  ]) {
    const match = new RaidMatch('hammer');
    const victim = match.runners[0];
    for (const r of match.runners) r.basic = 90;
    match.move(0, 1, 0);
    applyCrowdControl(victim, order);
    for (let tick = 0; tick <= 10; tick++) {
      const percent = tick < 4 ? 50 : tick < 10 ? 20 : 0;
      assert.equal(activeSlow(victim)?.percent ?? 0, percent);
      const x = victim.x;
      match.step();
      assert.ok(Math.abs(victim.x - x - (4.8 / 30) * (1 - percent / 100)) < 1e-8);
    }
  }
});

test('Frozen Ground locks actions for fifteen ticks before its two-second slow starts', () => {
  const match = new RaidMatch(['froze', 'jade', 'hammer', 'bastion']);
  const [caster, , target, immune] = match.runners;
  for (const r of match.runners) Object.assign(r, { basic: 1000, x: 0, z: 0 });
  caster.rage = 100;
  immune.x = 15;
  assert.ok(match.cast(0, 3));
  match.step();
  assert.equal(target.stunned, 15);
  assert.equal(immune.stunned, 0);
  assert.equal(activeSlow(target), undefined);
  assert.ok(match.move(2, 1, 0));
  const x = target.x;
  target.basic = 0;
  for (let i = 0; i < 15; i++) {
    assert.equal(match.jump(2), false);
    assert.equal(match.cast(2, 0), false);
    match.step();
  }
  assert.equal(target.x, x);
  assert.equal(target.basic, 0);
  assert.deepEqual(activeSlow(target), { percent: 40, ticks: 60, delay: 0 });
  assert.ok(match.cast(2, 0));
  for (let i = 0; i < 60; i++) match.step();
  assert.equal(activeSlow(target), undefined);
});

test('Whirlwind ignores a ground stun and Leap cannot land after a direct stun', () => {
  const match = new RaidMatch(['flare', 'hammer', 'hammer', 'hammer']);
  for (const r of match.runners) Object.assign(r, { basic: 1000, x: 0, z: 0, rage: 100 });
  assert.ok(match.cast(2, 2));
  assert.ok(match.cast(3, 1, { x: 1, z: 1 }));
  assert.ok(match.cast(0, 3, { x: 0, z: 0 }));
  match.step();
  assert.equal(match.runners[2].stunned, 0);
  assert.equal(match.runners[3].stunned, 45);
  for (let i = 0; i < 16; i++) match.step();
  assert.equal(match.runners[3].leap, null);
  assert.ok(!match.actions.some((a) => a.slot === 3 && a.skill === 1 && a.phase === 'ground'));
});

test('online replay agrees on a stun, expiry tick and the casting slot cooldown', () => {
  const seats = ['theresa', 'jade', 'hammer', 'longshot'].map((hero, i) => ({
    hero,
    actor: i + 1,
  }));
  const host = new RaidRound(seats),
    peer = new RaidRound(seats);
  assert.ok(host.enqueue(1, { seq: 1, action: 'cast', payload: { skill: 1, target: 2 } }));
  for (let tick = 1; tick <= 33; tick++) {
    assert.ok(peer.replay(JSON.parse(JSON.stringify(host.advance(1)))));
    assert.deepEqual(peer.match.runners, host.match.runners);
    assert.equal(peer.match.runners[2].stunned, tick < 9 ? 0 : Math.max(0, 32 - tick));
    assert.equal(peer.match.runners[0].cooldowns[1], 390 - tick);
  }
});
