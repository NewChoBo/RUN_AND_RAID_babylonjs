import assert from 'node:assert/strict';
import test from 'node:test';
import { HEROES, RaidMatch } from '../../src/game/raid/raid-match.ts';
import { distance } from '../../src/game/raid/raid-rules.ts';
import { inRaidSight } from '../../src/game/raid/raid-sight.ts';
import { WAGON_BODY, wagonCenter, wagonContact } from '../../src/game/raid/wagon.ts';

function practice(hero, playerAspect) {
  const match = new RaidMatch(hero, playerAspect);
  for (const runner of match.runners)
    Object.assign(runner, { basic: 10000, brake: 0.4, appliedBrake: 0.4, z: -30 });
  return match;
}

test('a frontal slash and a basic reach the wagon flank when its nearest corner lies outside their cone', () => {
  const match = practice('rildin');
  const runner = match.runners[0];
  const center = wagonCenter(0);
  runner.x = center.x - WAGON_BODY.halfWidth - 2;
  runner.z = center.z - WAGON_BODY.halfDepth - 1;
  const closest = wagonContact(runner, 0);
  assert.ok(closest.z - runner.z < closest.x - runner.x);
  assert.ok(distance(runner, center) > HEROES.rildin.reach);
  assert.equal(match.previewSkill(0, 0, null).count, 1);
  assert.ok(match.cast(0, 0));
  match.step();
  assert.equal(match.damage[0], HEROES.rildin.power + HEROES.rildin.basicAttack);
  const basic = match.actions.find((action) => action.skill === 'basic');
  assert.equal(basic.to.x, closest.x);
  assert.ok(basic.to.z > closest.z);
});

test('a ground cast can clip the body, while a just-clear circle misses it', () => {
  const match = practice('longshot');
  const runner = match.runners[0];
  const center = wagonCenter(0);
  runner.z = 4;
  const { radius } = match.skillRange(0, 1);
  const near = { x: center.x - WAGON_BODY.halfWidth - radius + 0.01, z: center.z };
  assert.ok(distance(center, near) > radius);
  assert.equal(match.previewSkill(0, 1, { ...near, x: near.x - 0.02 }).count, 0);
  assert.equal(match.previewSkill(0, 1, near).count, 1);
  assert.ok(match.cast(0, 1, near));
  match.step();
  assert.ok(runner.wagonDamage > 0);
});

test('a sliver of wagon side on screen permits a basic only inside the visible arc and reach', () => {
  let aspect = 4 / 3;
  const match = practice('longshot', () => aspect);
  for (let i = 0; i < 180; i++) match.step();
  const caster = match.runners[0];
  const center = wagonCenter(match.tick);
  caster.x = center.x - WAGON_BODY.halfWidth - 6.6;
  caster.z = 8;
  assert.equal(inRaidSight(caster, center, 2, aspect), false);
  assert.equal(inRaidSight(caster, wagonContact(caster, match.tick), 2, aspect), false);
  assert.ok(match.canTarget(0, 'wagon'));
  aspect = 0.5;
  assert.equal(match.canTarget(0, 'wagon'), false);

  aspect = 0.8;
  caster.z = 4.2;
  caster.basic = 0;
  match.step();
  const impact = match.actions.find((action) => action.slot === 0 && action.skill === 'basic')?.to;
  assert.ok(impact && inRaidSight(caster, impact, 2, aspect));
  assert.ok(distance(caster, impact) <= HEROES.longshot.reach);
  assert.ok(impact.z > wagonContact(caster, match.tick).z);
});

test('a projectile clips the right wheel of the shifted wagon and a parallel shot outside it misses', () => {
  for (const [offset, hits] of [
    [-0.4, true],
    [0.4, false],
  ]) {
    const match = practice('flare');
    const runner = match.runners[0];
    while (match.tick < 1200 && (wagonCenter(match.tick).x < 1 || runner.stunned)) match.step();
    const center = wagonCenter(match.tick);
    assert.ok(center.x >= 1);
    Object.assign(runner, { x: center.x + WAGON_BODY.halfWidth + offset, z: 7 });
    assert.ok(match.cast(0, 0, { dx: 0, dz: 1 }));
    while (match.projectiles.length) match.step();
    assert.equal(runner.wagonDamage > 0, hits);
    if (hits) assert.equal(match.endedProjectiles[0].z, center.z - WAGON_BODY.halfDepth);
  }
});

test('the wide edge of a piercing blade can cross the body once while its centre line passes beside it', () => {
  const match = practice('swift');
  const runner = match.runners[0];
  Object.assign(runner, { x: wagonCenter(0).x + WAGON_BODY.halfWidth + 2, z: 5 });
  assert.ok(match.cast(0, 0, { dx: 0, dz: 1 }));
  while (match.projectiles.length) match.step();
  assert.equal(runner.wagonDamage, HEROES.swift.power * 2);
});

test('a fireball hitting a rival beside the wagon also splashes the nearby hull once', () => {
  const match = practice('flare');
  const [caster, , rival] = match.runners;
  caster.x = rival.x = wagonCenter(0).x + WAGON_BODY.halfWidth + 1.7;
  caster.z = 5;
  rival.z = 8.1;
  const hp = rival.hp;
  assert.ok(match.cast(0, 0, { dx: 0, dz: 1 }));
  while (match.projectiles.length) match.step();
  const [impact] = match.endedProjectiles;
  assert.ok(distance(impact, wagonCenter(match.tick)) > 3);
  assert.equal(hp - rival.hp, HEROES.flare.power * 3);
  assert.equal(caster.wagonDamage, HEROES.flare.power * 3);
});

test('Dark Blades sweeping along the rear of the carriage scores only once per dash', () => {
  const match = practice('kali');
  const caster = match.runners[0];
  Object.assign(caster, { x: 1.4, z: 8.4, rage: 100 });
  assert.ok(match.cast(0, 3, { dx: -1, dz: 0.4 }));
  while (caster.dash) match.step();
  assert.equal(caster.wagonDamage, HEROES.kali.power * 4);
});
