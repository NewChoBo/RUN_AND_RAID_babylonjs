import assert from 'node:assert/strict';
import test from 'node:test';
import { HEROES, RAID_HZ, RaidMatch } from '../../src/game/raid/raid-match.ts';

function encounter(hero = 'abyss') {
  const match = new RaidMatch([hero, 'jade', 'hammer', 'kali']);
  for (const runner of match.runners)
    Object.assign(runner, { basic: 10000, x: 0, z: 0, brake: 0.4, appliedBrake: 0.4 });
  match.runners[3].z = -10;
  return match;
}

function advance(match, ticks) {
  for (let i = 0; i < ticks; i++) match.step();
}

test('Sacrifice checks a 5m inclusive radius at spell impact before barriers and leaves basics unchanged', () => {
  const spellDamage = HEROES.abyss.power * 2.4;
  for (const [x, scale] of [
    [5, 1.25],
    [5.01, 1],
  ]) {
    const match = encounter();
    const [caster, , target] = match.runners;
    target.x = x;
    target.barrier = { amount: 10, until: 100 };
    assert.ok(match.cast(0, 0, { dx: 1, dz: 0 }));
    advance(match, 10);
    assert.equal(HEROES.hammer.hp - target.hp, spellDamage * scale - 10);
    assert.equal(match.healthChanges.filter((h) => h.target === target.slot).length, 1);
    const afterSpell = target.hp;
    Object.assign(target, { x: 0, z: 3 });
    caster.basic = 0;
    match.step();
    assert.equal(afterSpell - target.hp, HEROES.abyss.basicAttack);
  }
});

test('the delayed Distortion uses the current distance from Abyss to each victim, not the field centre', () => {
  const match = encounter();
  const [caster, , near, far] = match.runners;
  caster.x = -5;
  near.x = 4;
  Object.assign(far, { x: -1.1, z: 0 });
  assert.ok(match.cast(0, 1, { x: 0, z: 6 }));
  advance(match, RAID_HZ - 1);
  caster.x = 4;
  match.step();
  assert.equal(HEROES.hammer.hp - near.hp, 37.5);
  assert.equal(HEROES.kali.hp - far.hp, 30);
});

test('the wagon is eligible and an archived runner keeps its borrowed spell damage at either distance', () => {
  for (const [hero, z, expected] of [
    ['abyss', 5.5, 30],
    ['abyss', 4, 24],
    ['dwight', 5.5, 30],
    ['dwight', 4, 30],
  ]) {
    const match = encounter(hero);
    match.runners[0].z = z;
    assert.ok(match.cast(0, 0, { dx: 0, dz: 1 }));
    advance(match, 12);
    assert.equal(match.damage[0], expected);
  }
});

test('an orb still in flight after knockout loses Sacrifice and the passive returns on respawn', () => {
  const match = encounter();
  const [caster, , target, killer] = match.runners;
  caster.hp = 1;
  target.x = 4;
  Object.assign(killer, { x: 0, z: 2 });
  assert.ok(match.cast(0, 0, { dx: 1, dz: 0 }));
  assert.ok(match.cast(killer.slot, 0));
  match.step();
  assert.ok(caster.respawn);
  advance(match, 10);
  assert.equal(HEROES.hammer.hp - target.hp, HEROES.abyss.power * 2.4);
  advance(match, caster.respawn);
  assert.equal(caster.respawn, 0);
  Object.assign(caster, { x: 0, z: 0, brake: 0.4, appliedBrake: 0.4 });
  target.x = 3;
  const beforePulse = target.hp;
  assert.ok(match.cast(0, 2));
  advance(match, RAID_HZ / 2);
  assert.equal(beforePulse - target.hp, 1.2 * HEROES.abyss.power * 1.25);
});
