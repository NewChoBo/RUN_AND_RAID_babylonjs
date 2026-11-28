import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Scene } from '@babylonjs/core';
import {
  RaidMatch,
  raidRoadTravel,
  raidRunnerPositionAfter,
} from '../../src/game/raid/raid-match.ts';
import { createRaidDashWind } from '../../src/platform/babylon/raid/raid-dash-wind.ts';

test('wind follows the actual ground dash, disappears on early recast, and reuses its mesh', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidDashWind(scene);
  const match = new RaidMatch('kaiken'),
    runner = match.runners[0];
  assert.ok(match.cast(0, 2));
  draw(match, 0);
  assert.equal(scene.meshes.length, 0);
  match.step();
  draw(match, 0.5);
  const wind = scene.getMeshByName('rush wind'),
    dash = runner.dash;
  const { x, z } = raidRunnerPositionAfter(runner, 0.5);
  assert.deepEqual(wind.position.asArray(), [x, 0.88, z]);
  assert.equal(
    wind.rotation.y,
    Math.atan2(dash.to.x - dash.from.x, dash.to.z - dash.from.z - raidRoadTravel(dash.ticks)),
  );
  const length = wind.scaling.z;
  draw(match, 0.5);
  assert.equal(wind.scaling.z, length);
  assert.ok(length > 0 && !wind.isPickable);
  assert.ok(match.cast(0, 2));
  draw(match, 0.5);
  assert.ok(!wind.isEnabled());

  const rematch = new RaidMatch('rildin');
  assert.ok(rematch.cast(0, 2, { dx: -1, dz: 0 }));
  rematch.step();
  draw(rematch, 0.5);
  assert.ok(wind.isEnabled() && wind.rotation.y < 0);
  rematch.runners[0].stunned = 3;
  draw(rematch, 0.5);
  assert.ok(!wind.isEnabled());
  assert.equal(scene.meshes.length, 1);
});

test('recoil, airborne volleys and shadow blades retain their own effects', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidDashWind(scene);
  for (const [hero, skill] of [
    ['vallet', 1],
    ['longshot', 2],
    ['kali', 3],
  ]) {
    const match = new RaidMatch(hero);
    match.runners[0].rage = 100;
    assert.ok(match.cast(0, skill, { dx: 1, dz: 0 }));
    assert.ok(match.runners[0].dash);
    match.step();
    draw(match, 0.5);
  }
  assert.equal(scene.meshes.length, 0);
});

test('Drizz only parts the air after his thrown hand connects, and concurrent rushes share geometry', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const drawScene = new Scene(engine),
    draw = createRaidDashWind(drawScene);
  const match = new RaidMatch(['drizz', 'magnus', 'swift', 'hof']);
  const [drizz, , target] = match.runners;
  target.x = drizz.x;
  target.z = drizz.z + 3;
  drizz.rage = 100;
  for (const r of match.runners) r.basic = 999;
  assert.ok(match.cast(0, 3, { dx: 0, dz: 1 }));
  draw(match, 0.5);
  assert.equal(drawScene.meshes.length, 0);
  while (!drizz.dash && match.tick < 12) match.step();
  assert.ok(drizz.dash);
  assert.ok(match.cast(1, 3));
  assert.ok(match.cast(1, 0));
  draw(match, 0.9);
  const [handRush, shieldRush] = drawScene.meshes;
  assert.ok(handRush.isEnabled() && shieldRush.isEnabled());
  assert.equal(handRush.geometry, shieldRush.geometry);
  assert.equal(handRush.material, shieldRush.material);
  while (match.tick < 18) match.step();
  draw(match, 0.5);
  assert.ok(!handRush.isEnabled() && !shieldRush.isEnabled());
});
