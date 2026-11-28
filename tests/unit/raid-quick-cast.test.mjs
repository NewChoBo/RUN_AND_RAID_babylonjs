import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RaidMatch,
  RAID_HZ,
  RAID_LEAP_TICKS,
  raidRoadTravel,
  raidRunnerHeight,
} from '../../src/game/raid/raid-match.ts';
import { RAID_FRONT_Z } from '../../src/game/raid/runner-motion.ts';
import { createRaidFeature } from '../../src/game/raid/raid-feature.ts';
import { RaidRound } from '../../src/game/raid/raid-round.ts';

test('four-player replay resolves drag-out from the same accepted inputs as the host', () => {
  const seats = ['longshot', 'hof', 'alice', 'theresa'].map((hero, actor) => ({
    hero,
    actor: actor + 1,
  }));
  const host = new RaidRound(seats),
    peer = new RaidRound(seats);
  for (const [actor, payload] of [
    [1, { skill: 0, dx: -2, dz: 1 }],
    [2, { skill: 0, x: 2, z: 2 }],
    [3, { skill: 1, target: 0 }],
    [4, { skill: 0 }],
  ])
    assert.ok(host.enqueue(actor, { seq: 1, action: 'cast', payload }));
  assert.ok(peer.replay(host.advance(1)));
  for (const [actor, skill] of [
    [1, 2],
    [2, 1],
    [3, 2],
  ])
    assert.ok(host.enqueue(actor, { seq: 2, action: 'cast', payload: { skill, repeat: true } }));
  assert.ok(peer.replay(host.advance(3)));
  assert.ok(host.match.runners[0].dash);
  assert.equal(host.match.runners[2].heroView.turrets.length, 2);
  assert.ok(host.match.runners[0].barrier);
  assert.deepEqual(peer.match.runners, host.match.runners);
  assert.deepEqual(peer.match.actions, host.match.actions);
});

function battle(hero) {
  const match = new RaidMatch([hero, 'jade', 'rime', 'hammer']);
  for (const r of match.runners)
    Object.assign(r, { basic: 9999, brake: 0.4, appliedBrake: 0.4, x: 0, z: r.slot === 2 ? 3 : 0 });
  const cast = (payload) => createRaidFeature(match).commands.cast({ slot: 0 }, payload).ok;
  return { match, cast, r: match.runners[0], enemy: match.runners[2] };
}

test('directional quick cast keeps a successful bearing across misses, team pings and malformed commands', () => {
  const { match, cast, r } = battle('longshot');
  assert.equal(cast({ skill: 2, repeat: true }), false);
  assert.ok(cast({ skill: 0, dx: -2, dz: 1 }));
  assert.ok(match.callTarget(0, 'wagon'));
  assert.equal(cast({ skill: 2, dx: 0, dz: 0 }), false);
  assert.equal(cast({ skill: 2, repeat: true, dx: 1 }), false);
  assert.equal(r.cooldowns[2], 0);
  assert.ok(cast({ skill: 2, repeat: true }));
  assert.ok(r.dash.to.x < r.x && r.dash.to.z > r.z);
  assert.equal(cast({ skill: 2, repeat: true }), false);
});

test('ground quick cast reuses relative distance and direction after the runner moves, including zero offset', () => {
  const { match, cast, r } = battle('hof');
  assert.ok(cast({ skill: 0, x: 2, z: 3 }));
  r.x = -1;
  r.z = 1;
  assert.equal(cast({ skill: 1, x: 20, z: 4 }), false);
  assert.ok(cast({ skill: 1, repeat: true }));
  const tower = r.heroView.turrets[1];
  assert.ok(Math.abs(tower.x - 1) < 1e-8 && Math.abs(tower.z - 4) < 1e-8);
  assert.ok(cast({ skill: 2, x: r.x, z: r.z }));
  r.cooldowns[0] = 0;
  assert.deepEqual(match.previewRepeat(0, 0).point, { x: r.x, z: r.z });
});

test('Hammer quick cast remembers the selected ground offset when his body stops at the wagon', () => {
  const { match, cast, r } = battle('hammer');
  Object.assign(r, { x: 0, z: 7 });
  assert.ok(cast({ skill: 1, x: 6, z: 15 }));
  for (let tick = 0; tick < RAID_LEAP_TICKS; tick++) match.step();
  assert.equal(r.z, RAID_FRONT_Z);
  Object.assign(r, { x: -4, z: 0 });
  r.cooldowns[1] = 0;
  assert.equal(cast({ skill: 1, x: -4, z: 14 }), false);
  const preview = match.previewRepeat(0, 1);
  assert.equal(preview.status, 'ready');
  assert.deepEqual(preview.point, { x: 2, z: 8 });
  assert.ok(cast({ skill: 1, repeat: true }));
  for (let tick = 0; tick < RAID_LEAP_TICKS; tick++) match.step();
  const landing = match.actions.findLast((cue) => cue.slot === 0 && cue.skill === 1);
  assert.deepEqual(landing.to, { x: 2, z: 8 - raidRoadTravel(RAID_LEAP_TICKS) });
});

test('target quick cast remembers the selected unit before impact and validates current life, team and range', () => {
  const { match, cast, r, enemy } = battle('alice');
  assert.ok(cast({ skill: 1, target: 1 }));
  assert.ok(cast({ skill: 2, repeat: true }));
  assert.ok(match.runners[1].barrier);
  r.cooldowns[1] = r.cooldowns[2] = 0;
  assert.ok(cast({ skill: 1, target: enemy.slot }));
  enemy.z = 40;
  assert.equal(cast({ skill: 2, repeat: true }), false);
  assert.equal(r.cooldowns[2], 0);
  enemy.z = 3;
  enemy.hp = 1;
  match.step();
  assert.ok(enemy.respawn);
  enemy.respawn = 1;
  match.step();
  assert.equal(cast({ skill: 2, repeat: true }), false);
});

test('a directional finisher fires toward a visible previous unit at its current position', () => {
  const { match, cast, r, enemy } = battle('vallet');
  assert.ok(cast({ skill: 0, target: enemy.slot }));
  enemy.x = 4;
  r.rage = 100;
  assert.ok(cast({ skill: 3, repeat: true }));
  assert.ok(Math.abs(match.projectiles[0].dx - 0.8) < 1e-9);
});

test('Theresa taps both heals at her feet and the ultimate samples moving allies once per second', () => {
  const { match, r, cast } = battle('theresa');
  const ally = match.runners[1];
  r.hp = ally.hp = 20;
  r.rage = 100;
  assert.equal(cast({ skill: 0, ally: 1 }), false);
  assert.ok(cast({ skill: 0 }));
  assert.deepEqual([r.hp, ally.hp], [48, 34]);
  assert.ok(cast({ skill: 3 }));
  ally.x = 8;
  for (let i = 0; i < RAID_HZ; i++) match.step();
  assert.deepEqual([r.hp, ally.hp], [48, 34]);
  ally.x = 1;
  for (let i = 0; i < RAID_HZ; i++) match.step();
  assert.deepEqual([r.hp, ally.hp], [48, 44]);
});

test('Emergency Escape lands on a second tap or after two seconds with a single impact and cooldown', () => {
  for (const recast of [true, false]) {
    const { match, r, cast, enemy } = battle('vallet');
    assert.ok(cast({ skill: 2 }));
    const hp = enemy.hp;
    for (let i = 0; i < 30; i++) match.step();
    assert.ok(raidRunnerHeight(r) > 3);
    assert.equal(enemy.hp, hp);
    if (recast) {
      assert.ok(cast({ skill: 2 }));
      match.step();
    } else for (let i = 0; i < 30; i++) match.step();
    assert.equal(raidRunnerHeight(r), 0);
    assert.equal(enemy.hp, hp - 30);
    assert.equal(r.cooldownDurations[2], 21 * RAID_HZ);
    assert.equal(cast({ skill: 2 }), false);
  }
});

test('Freesia can shield an ally or blind an enemy, conceal herself, and plant a trap on empty ground', () => {
  const { match, r, cast, enemy } = battle('freesia');
  assert.ok(cast({ skill: 1, target: 1 }));
  assert.ok(match.runners[1].controlGuardUntil);
  r.cooldowns[1] = 0;
  assert.ok(cast({ skill: 1, target: 2 }));
  match.step();
  assert.ok(enemy.blindUntil);
  assert.ok(cast({ skill: 2 }));
  assert.equal(match.canTarget(2, 0), false);
  r.rage = 100;
  const hp = enemy.hp;
  assert.ok(cast({ skill: 3, x: -6, z: 3 }));
  match.step();
  assert.equal(enemy.hp, hp);
  enemy.x = -6;
  match.step();
  assert.equal(enemy.hp, hp - 50);
  assert.equal(enemy.slowed, 90);
});

test('a missed Fist of Ruin never moves Drizz or damages a nearby enemy', () => {
  const { match, r, cast, enemy } = battle('drizz');
  r.rage = 100;
  const hp = enemy.hp;
  assert.ok(cast({ skill: 3, dx: -1, dz: 0 }));
  for (let i = 0; i < 30; i++) match.step();
  assert.equal(r.x, 0);
  assert.equal(r.dash, null);
  assert.equal(enemy.hp, hp);
});
