import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { daggerReleaseTicks } from '../../src/content/raid/heroes/swift.ts';
import { RaidMatch, RAID_HZ, WAGON, HEROES } from '../../src/game/raid/raid-match.ts';
import { createSwiftDaggerFx } from '../../src/platform/babylon/raid/raid-swift-dagger.ts';

function practice() {
  const match = new RaidMatch(['swift', 'rime', 'rildin', 'rime']);
  for (const [slot, r] of match.runners.entries())
    Object.assign(r, { basic: 1000, brake: 0.4, x: slot % 2 ? 2 : 0, z: slot < 2 ? 0 : 7 });
  return match;
}

function step(match, ticks) {
  for (let i = 0; i < ticks; i++) match.step();
}

test('the archived runner with a borrowed kit keeps its instant mark', () => {
  const match = new RaidMatch(['silurian', 'rime', 'rildin', 'kali']);
  const [caster, , enemy] = match.runners;
  Object.assign(caster, { x: 0, z: 0 });
  Object.assign(enemy, { x: 0, z: 7 });
  assert.ok(match.cast(0, 2, 2));
  assert.equal(caster.heroView.trackingDagger, null);
  match.step();
  assert.equal(caster.heroView.quarry, 2);
});

test('tracking dagger follows only the selected target and starts the five-second mark on impact', () => {
  const match = practice(),
    [caster, , target, other] = match.runners;
  assert.equal(match.cast(0, 2, 1), false);
  target.z = 13;
  assert.equal(match.cast(0, 2, 2), false);
  target.z = 7;
  const hp = target.hp,
    otherHp = other.hp;
  assert.ok(match.cast(0, 2, 2));
  step(match, daggerReleaseTicks);
  const shot = caster.heroView.trackingDagger;
  assert.ok(shot);
  assert.equal(target.hp, hp);
  assert.equal(caster.heroView.quarry, null);
  other.z = 3;
  other.x = 0;
  target.x = 3;
  step(match, 1);
  assert.ok(shot.x > 0);
  assert.equal(target.hp, hp);
  step(match, 1);
  target.x = 1.5;
  while (caster.heroView.trackingDagger) match.step();
  assert.equal(target.hp, hp - HEROES.swift.power);
  assert.equal(other.hp, otherHp);
  assert.equal(caster.lastStrike, 2);
  assert.equal(caster.heroView.quarry, 2);
  step(match, 5 * RAID_HZ - 1);
  assert.equal(caster.heroView.quarry, 2);
  match.step();
  assert.equal(caster.heroView.quarry, null);
});

test('deflection, interruption during the throw and deaths leave no stray mark', () => {
  for (const outcome of ['block', 'windup', 'target knockout', 'caster knockout']) {
    const match = practice(),
      [caster, , target] = match.runners;
    assert.ok(match.cast(0, 2, 2));
    if (outcome === 'windup') caster.stunned = 3;
    else {
      step(match, daggerReleaseTicks + 1);
      assert.ok(caster.heroView.trackingDagger);
      if (outcome === 'block') assert.ok(match.cast(2, 1));
      if (outcome === 'target knockout') {
        target.hp = 1;
        assert.ok(match.cast(1, 1, 2));
      }
      if (outcome === 'caster knockout') {
        caster.hp = 1;
        assert.ok(match.cast(3, 1, 0));
      }
    }
    step(match, 20);
    assert.equal(caster.heroView.trackingDagger, null, outcome);
    assert.equal(caster.heroView.quarry, null, outcome);
  }
});

test('released dagger flies from the throwing hand and disappears at wagon impact and on rematch', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createSwiftDaggerFx(scene);
  const match = practice(),
    [caster] = match.runners;
  const rig = new TransformNode('swift facing', scene);
  const hand = new TransformNode('Bip001 L Hand', scene);
  hand.parent = rig;
  hand.position.set(0.6, 1.4, 0.4);
  assert.ok(match.cast(0, 2, 'wagon'));
  draw(match, 0);
  assert.equal(scene.getTransformNodeByName('Swift tracking dagger'), null);
  step(match, daggerReleaseTicks);
  draw(match, 0);
  const dagger = scene.getTransformNodeByName('Swift tracking dagger');
  assert.ok(dagger.isEnabled());
  assert.ok(dagger.position.equalsWithEpsilon(hand.position, 1e-5));
  const leaving = dagger.position.clone();
  step(match, 2);
  draw(match, 0.4);
  assert.ok(dagger.position.z > leaving.z && dagger.position.z < WAGON.z);
  draw(practice(), 0);
  assert.equal(dagger.isEnabled(), false);
  while (caster.heroView.trackingDagger) match.step();
  draw(match, 0);
  assert.equal(dagger.isEnabled(), false);
  assert.equal(caster.heroView.quarry, 'wagon');
});
