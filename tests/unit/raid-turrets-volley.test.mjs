import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidMatch, raidRunnerHeight, WAGON } from '../../src/game/raid/raid-match.ts';
import { RAID_RUN_LIMIT_X } from '../../src/game/raid/raid-rules.ts';

function arena(roster) {
  const m = new RaidMatch(roster);
  for (const r of m.runners)
    Object.assign(r, { basic: 10000, x: 0, z: 0, brake: 0.4, appliedBrake: 0.4 });
  return m;
}
function advance(m, count) {
  for (let i = 0; i < count; i++) m.step();
}

test('Rolling Shot moves on the selected course heading during the original flip and lands five separate arrows', () => {
  const m = arena(['longshot', 'hof', 'hammer', 'jade']);
  const [archer, , enemy, far] = m.runners;
  enemy.x = 2.5;
  enemy.z = -0.6;
  far.x = -6;
  const farHealth = far.hp;
  const health = enemy.hp,
    start = { x: archer.x, z: archer.z };
  const aim = m.previewSkill(0, 2, { x: 1, z: 0 });
  assert.deepEqual(aim.dash.end, { x: 5, z: 0 });
  assert.ok(m.cast(0, 2, { dx: 1, dz: 0 }));
  const releases = [],
    impacts = [];
  for (let i = 1; i <= 45; i++) {
    m.step();
    if (archer.heroView.airArrows.some((a) => a.tick === i)) releases.push(i);
    if (m.healthChanges.some((h) => h.tick === i && h.from === 0 && h.target === 2))
      impacts.push(i);
    if (i <= 3) assert.deepEqual({ x: archer.x, z: archer.z }, start);
    if (i === 18) assert.ok(raidRunnerHeight(archer) > 1);
    if (i >= 36) assert.ok(raidRunnerHeight(archer) < 0.02);
  }
  assert.deepEqual(releases, [7, 13, 19, 25, 31]);
  assert.deepEqual(
    impacts,
    releases.map((t) => t + 3),
  );
  assert.deepEqual({ x: archer.x, z: archer.z }, aim.dash.end);
  assert.equal(archer.dash, null);
  assert.equal(health - enemy.hp, 5 * 13);
  assert.equal(far.hp, farHealth); // Jade stayed outside the flight path.
});
test('airborne casts inherit jump height, retreat on a backward aim and stop firing if interrupted', () => {
  const m = arena(['longshot', 'hof', 'hammer', 'jade']),
    r = m.runners[0];
  assert.ok(m.jump(0));
  advance(m, 6);
  const height = raidRunnerHeight(r);
  assert.ok(m.cast(0, 2, { dx: 0, dz: -1 }));
  assert.equal(raidRunnerHeight(r), height);
  advance(m, 7);
  assert.ok(r.z < 0 && r.heroView.airArrows.length === 1);
  r.stunned = 5;
  advance(m, 12);
  assert.equal(r.dash, null);
  assert.equal(r.heroView.airArrows.length, 0);
  r.cooldowns[2] = 0;
  r.x = RAID_RUN_LIMIT_X - 0.5;
  const aim = m.previewSkill(0, 2, { x: r.x + 1, z: r.z });
  assert.equal(aim.dash.end.x, RAID_RUN_LIMIT_X);
  assert.ok(m.cast(0, 2, { dx: 1, dz: 0 }));
  advance(m, 45);
  assert.equal(r.x, aim.dash.end.x);
});
test('three independent Hof installations acquire and fire by range, with frost and three consecutive electric pulses', () => {
  const m = arena(['hof', 'longshot', 'hammer', 'jade']),
    r = m.runners[0],
    enemy = m.runners[2];
  enemy.hp = 1000;
  enemy.z = 4;
  m.runners[3].x = 100;
  const point = { x: 0, z: 6 };
  assert.equal(m.cast(0, 0, { x: 0, z: 6.1 }), false);
  for (const slot of [0, 1, 2]) assert.ok(m.cast(0, slot, point));
  assert.deepEqual(
    r.heroView.turrets.map((t) => t.slot),
    [0, 1, 2],
  );
  advance(m, 35);
  assert.ok(r.heroView.turrets.every((t) => !t.shot));
  m.step();
  assert.deepEqual(
    r.heroView.turrets.map((t) => t.shot.tick),
    [36, 36, 36],
  );
  assert.equal(enemy.slows[0].percent, 15);
  advance(m, 59);
  assert.equal(enemy.silenced, 0);
  m.step();
  assert.equal(enemy.silenced, 30);
  advance(m, 31);
  assert.equal(enemy.silenced, 0);
  assert.ok(r.heroView.turrets.length === 3);
  advance(m, 31);
  assert.ok(r.heroView.turrets.every((t) => t.x === 0 && t.z === 6));
  r.cooldowns[0] = 0;
  assert.ok(m.cast(0, 0, { x: 1, z: 1 }));
  assert.equal(r.heroView.turrets.length, 3);
  assert.equal(r.heroView.turrets.find((t) => t.slot === 0).x, 1);
});
test('Remote Detonation originates at each owned turret, applies overlap and boss reductions, and refunds the remaining cooldown', () => {
  const m = arena(['hof', 'hof', 'hammer', 'jade']),
    [r, ally, enemy] = m.runners;
  r.z = ally.z = 6;
  enemy.z = 7;
  enemy.hp = 200;
  assert.equal(m.cast(0, 3), false);
  for (const slot of [0, 1, 2]) assert.ok(m.cast(0, slot, { x: slot - 1, z: 6 }));
  assert.ok(m.cast(1, 0, { x: -1, z: 6 }));
  r.z = -15;
  r.rage = 100;
  assert.ok(m.cast(0, 3));
  assert.equal(r.heroView.turrets.length, 0);
  assert.equal(ally.heroView.turrets.length, 1);
  assert.deepEqual(r.cooldowns.slice(0, 3), [225, 225, 240]);
  assert.equal(r.heroView.blasts.length, 3);
  m.step();
  assert.equal(m.damage[0], 51);
  assert.equal(enemy.hp, 200 - 102);
  assert.equal(
    m.healthChanges.filter((h) => h.tick === 1 && h.from === 0 && h.target === 'wagon').length,
    1,
  );
  assert.ok(WAGON.z - r.z > 6);
});
