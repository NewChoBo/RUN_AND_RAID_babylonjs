import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, NullEngine, Scene } from '@babylonjs/core';
import { RaidMatch, raidRunnerHeight } from '../../src/game/raid/raid-match.ts';
import { createRaidStatusEffects } from '../../src/platform/babylon/raid/raid-status-effects.ts';

function field(t) {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const render = createRaidStatusEffects(scene);
  const positions = [
    { x: -2, z: 1 },
    { x: 2, z: 3 },
    { x: -2, z: 3 },
    { x: 2, z: 1 },
  ];
  const barHeight = (slot) => 1.8 + slot / 4;
  return {
    scene,
    positions,
    barHeight,
    draw(view, sub = 0, team = 0, still = false) {
      render(view, positions, sub, team, barHeight, still);
    },
    visible(kind) {
      return scene.meshes.filter((m) => m.isEnabled() && m.name === 'runner ' + kind);
    },
  };
}

test('Froze stuns both rivals before the delayed slow becomes visible, then clears the ankle effects', (t) => {
  const { scene, barHeight, draw, visible } = field(t);
  const match = new RaidMatch(['froze', 'jade', 'hammer', 'longshot']);
  for (const runner of match.runners) Object.assign(runner, { basic: 9999, x: 0, z: 0 });
  draw(match);
  assert.equal(scene.meshes.length, 0);
  match.runners[0].rage = 100;
  assert.ok(match.cast(0, 3));
  match.step();
  draw(match);
  const stars = visible('stun');
  assert.equal(stars.length, 2);
  assert.equal(stars[0].geometry, stars[1].geometry);
  assert.equal(stars[0].material, stars[1].material);
  assert.ok(stars.every((m) => !m.isPickable));
  for (const [index, star] of stars.entries()) {
    const box = star.getBoundingInfo().boundingBox;
    assert.ok(star.position.y + box.minimum.y > barHeight(index + 2) + 0.11);
  }
  assert.equal(visible('slow').length, 0);
  const angle = stars[0].rotation.y;
  draw(match, 0.5);
  assert.notEqual(stars[0].rotation.y, angle);
  for (let tick = 0; tick < 12; tick++) match.step();
  draw(match);
  assert.equal(visible('stun')[0], stars[0]);
  assert.ok(Math.abs(stars[0].rotation.y - angle) >= Math.PI - 1e-8);
  draw(match, 0.25, 0, true);
  const stillStun = stars[0].rotation.y;
  match.step();
  draw(match, 0.75, 0, true);
  assert.equal(visible('stun')[0].rotation.y, stillStun);
  while (match.runners[2].stunned) match.step();
  draw(match);
  assert.equal(visible('stun').length, 0);
  assert.equal(visible('slow').length, 2);
  draw(match, 0.25, 0, true);
  const still = visible('slow')[0].rotation.y;
  match.step();
  draw(match, 0.75, 0, true);
  assert.equal(visible('slow')[0].rotation.y, still);
  while (match.runners[2].slowed) match.step();
  draw(match);
  assert.equal(scene.meshes.filter((m) => m.isEnabled()).length, 0);
});

test('status cues follow the player in the air, coexist and vanish on concealment, death, result or reset', (t) => {
  const { scene, positions, barHeight, draw, visible } = field(t);
  const match = new RaidMatch(['freesia', 'jade', 'hammer', 'longshot']);
  assert.ok(match.cast(0, 2));
  const runner = match.runners[0];
  Object.assign(runner, {
    jumping: 10,
    silenced: 10,
    blindUntil: 12,
    taunt: { from: 2, until: 6 },
    hasteTicks: 10,
  });
  draw(match, 0.5);
  const glyphs = ['silence', 'taunt', 'blind'].map((kind) => visible(kind)[0]);
  assert.ok(glyphs.every((m) => m.billboardMode === Mesh.BILLBOARDMODE_ALL));
  assert.ok(
    glyphs[0].position.x < glyphs[1].position.x && glyphs[1].position.x < glyphs[2].position.x,
  );
  const height = raidRunnerHeight(runner, 0.5);
  assert.deepEqual(glyphs[1].position.asArray(), [
    positions[0].x,
    height + barHeight(0) + 0.32,
    positions[0].z,
  ]);
  assert.equal(visible('haste')[0].position.y, height + 0.29);
  runner.stunned = 6;
  draw(match, 0.5);
  const star = visible('stun')[0];
  assert.equal(star.position.x, positions[0].x);
  assert.equal(star.position.z, positions[0].z);
  const crown = star.getBoundingInfo().boundingBox;
  assert.ok(star.position.y + crown.minimum.y > height + barHeight(0) + 0.11);
  for (const glyph of glyphs) {
    const bottom = glyph.position.y + glyph.getBoundingInfo().boundingBox.minimum.y;
    assert.ok(bottom > star.position.y + crown.maximum.y);
  }
  const total = scene.meshes.length;
  draw(match, 0.5, 1);
  assert.ok(scene.meshes.every((m) => !m.isEnabled()));
  draw(match, 0.5);
  assert.equal(visible('taunt')[0], glyphs[1]);
  assert.equal(scene.meshes.length, total);
  draw({ tick: 12, runners: match.runners, result: null });
  assert.equal(visible('blind').length + visible('taunt').length, 0);
  assert.equal(visible('silence').length, 1);
  runner.respawn = 3;
  draw(match);
  assert.ok(scene.meshes.every((m) => !m.isEnabled()));
  runner.respawn = 0;
  draw(match);
  draw({ tick: match.tick, runners: match.runners, result: { reason: 'time', winner: 0 } });
  assert.ok(scene.meshes.every((m) => !m.isEnabled()));
  draw(new RaidMatch());
  assert.ok(scene.meshes.every((m) => !m.isEnabled()));
  assert.equal(scene.meshes.length, total);
});
