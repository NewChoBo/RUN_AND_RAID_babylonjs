import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidMatch, raidRunnerHeight, HEROES } from '../../src/game/raid/raid-match.ts';
import { RaidRound } from '../../src/game/raid/raid-round.ts';
import { JET_CAPACITY } from '../../src/game/raid/air-movement.ts';

function practice(hero) {
  const match = new RaidMatch(hero);
  for (const r of match.runners) r.basic = 1000;
  return {
    match,
    r: match.runners[0],
    step(n) {
      for (let i = 0; i < n; i++) match.step();
    },
  };
}

test('Longshot jumps again from the current height once per landing and can roll from that height', () => {
  const { match, r, step } = practice('longshot');
  assert.ok(match.jump(0));
  step(11);
  const apex = raidRunnerHeight(r);
  assert.ok(Math.abs(apex - 3.2) < 1e-6);
  assert.ok(match.jump(0));
  assert.equal(raidRunnerHeight(r), apex);
  assert.equal(match.jump(0), false);
  step(11);
  assert.ok(Math.abs(raidRunnerHeight(r) - 2 * apex) < 1e-6);
  step(30);
  assert.equal(r.air, null);
  assert.ok(match.jump(0));
  step(7);
  assert.ok(match.jump(0));
  step(2);
  const takeoff = raidRunnerHeight(r);
  assert.ok(match.cast(0, 2, { dx: 1, dz: 0 }));
  assert.equal(r.air, null);
  assert.equal(raidRunnerHeight(r), takeoff);
  assert.equal(match.jump(0), false);
  const normal = practice('hammer');
  assert.ok(normal.match.jump(0));
  assert.equal(normal.match.jump(0), false);
});

test('Hof spends fuel only under thrust, can release and resume, and refills on the ground', () => {
  const { match, r, step } = practice('hof');
  assert.ok(match.jump(0, true));
  step(16);
  assert.ok(r.jetFuel < JET_CAPACITY && r.jetFuel > 0);
  assert.ok(match.jump(0, false));
  const released = r.jetFuel;
  step(6);
  assert.equal(r.jetFuel, released);
  assert.ok(match.jump(0, true));
  step(released);
  assert.equal(r.jetFuel, 0);
  assert.equal(raidRunnerHeight(r), 5);
  assert.equal(match.jump(0, true), false);
  while (r.air) step(1);
  assert.equal(raidRunnerHeight(r), 0);
  assert.equal(r.jetFuel, 0);
  step(119);
  assert.equal(r.jetFuel, 59.5);
  step(2);
  assert.equal(r.jetFuel, JET_CAPACITY);
  assert.ok(match.jump(0, true));
  step(15);
  r.stunned = 6;
  step(1);
  assert.equal(r.air.thrust, false);
  const fuel = r.jetFuel;
  step(4);
  assert.equal(r.jetFuel, fuel);
});

test('host and peer replay held jet, release and both jump presses on the same ticks', () => {
  const seats = [
    { actor: 1, hero: 'hof' },
    { actor: 2, hero: 'longshot' },
  ];
  const host = new RaidRound(seats),
    peer = new RaidRound(seats);
  for (let tick = 0; tick < 35; tick++) {
    if (tick === 0 || tick === 12) assert.ok(host.enqueue(2, { seq: tick + 1, action: 'jump' }));
    if (tick === 0 || tick === 18 || tick === 24)
      assert.ok(host.enqueue(1, { seq: tick + 1, action: 'jump', payload: tick !== 18 }));
    assert.ok(peer.replay(JSON.parse(JSON.stringify(host.advance(1)))));
    for (const slot of [0, 2]) {
      const a = host.match.runners[slot],
        b = peer.match.runners[slot];
      assert.deepEqual(a.air, b.air);
      assert.equal(a.jetFuel, b.jetFuel);
    }
    if (tick === 17) assert.ok(host.match.runners[0].jetFuel < JET_CAPACITY);
    if (tick === 12) assert.ok(host.match.runners[2].air.second);
  }
});

test('rated basic ranges and published landing, rain, installation and spin radii reach the preview', () => {
  assert.deepEqual(
    ['hammer', 'magnus', 'kaiken', 'vallet', 'longshot', 'freesia'].map((h) => HEROES[h].reach),
    [3.5, 3.8, 4.5, 9, 11, 8],
  );
  for (const [hero, skill, range, radius] of [
    ['hammer', 1, 13, 5],
    ['longshot', 1, 13, 6],
    ['kaiken', 3, 8, 8],
    ['hof', 0, 6, 20],
    ['hof', 1, 6, 16],
    ['hof', 2, 6, 14],
  ])
    assert.deepEqual(new RaidMatch(hero).skillRange(0, skill), { range, radius });
});
