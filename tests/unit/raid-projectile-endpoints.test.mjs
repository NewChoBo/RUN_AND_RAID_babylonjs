import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidMatch } from '../../src/game/raid/raid-match.ts';

test('a fireball ending in its first tick leaves its own shape at the contact for that tick', () => {
  const match = new RaidMatch(['hammer', 'hammer', 'flare', 'hammer']);
  const [target, , caster] = match.runners;
  for (const runner of match.runners) runner.basic = 999;
  target.x = caster.x - 1.12;
  target.z = caster.z;
  target.stunned = 2;
  const hp = target.hp;
  assert.ok(match.cast(caster.slot, 0, { dx: -1, dz: 0 }));
  const [shot] = match.projectiles;
  const contactX = target.x + shot.attack.flight.contact.halfDepth;

  match.step();
  assert.equal(match.projectiles.length, 0);
  assert.deepEqual(match.endedProjectiles, [shot]);
  assert.ok(Math.abs(shot.x - contactX) < 1e-9);
  assert.ok(Math.abs(shot.z - target.z) < 1e-9);
  assert.equal(shot.remaining, 0);
  assert.equal(target.hp, hp - 30);
  match.step();
  assert.equal(match.endedProjectiles.length, 0);
  assert.equal(target.hp, hp - 30);
});

test('a missed shot ends at its range and clears on the next tick and in a fresh match', () => {
  const match = new RaidMatch('flare');
  assert.ok(match.cast(0, 0, { dx: -1, dz: 0 }));
  const [shot] = match.projectiles;
  const endX = shot.x - shot.attack.flight.reach;
  while (match.projectiles.length && match.tick < 40) match.step();
  assert.deepEqual(match.endedProjectiles, [shot]);
  assert.ok(Math.abs(shot.x - endX) < 1e-9);
  assert.equal(shot.remaining, 0);
  assert.equal(new RaidMatch('flare').endedProjectiles.length, 0);
  match.step();
  assert.equal(match.endedProjectiles.length, 0);
});
