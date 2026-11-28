import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Scene, Vector3, VertexBuffer } from '@babylonjs/core';
import { RaidRound } from '../../src/game/raid/raid-round.ts';
import { RAID_ROAD_WIDTH, RAID_RUN_LIMIT_X } from '../../src/game/raid/raid-rules.ts';
import { createRaidPingArrow } from '../../src/platform/babylon/raid/raid-ping-arrow.ts';

function setup(t) {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const draw = createRaidPingArrow(scene);
  const mesh = scene.getMeshByName('team ping ground arrow');
  assert.ok(mesh);
  return { scene, draw, mesh };
}

function arrowVertices(mesh) {
  assert.ok(mesh.isEnabled());
  const world = mesh.computeWorldMatrix(true);
  const vertices = mesh.getVerticesData(VertexBuffer.PositionKind);
  const points = [];
  for (let i = 0; i < vertices.length; i += 3)
    points.push(Vector3.TransformCoordinates(Vector3.FromArray(vertices, i), world));
  return points;
}

// Measure the visible geometry in metres along and across the requested direction.
function arrowTip(mesh, origin, target) {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const length = Math.hypot(dx, dz);
  const points = arrowVertices(mesh).map((point) => {
    const x = point.x - origin.x;
    const z = point.z - origin.z;
    return { along: (x * dx + z * dz) / length, across: (x * dz - z * dx) / length };
  });
  const tip = Math.max(...points.map((point) => point.along));
  assert.ok(tip > 0);
  assert.ok(points.every((point) => point.along >= -1e-5));
  assert.ok(points.some((point) => point.across < -1e-5));
  assert.ok(points.some((point) => point.across > 1e-5));
  assert.ok(points.filter((p) => p.along > tip - 1e-5).every((p) => Math.abs(p.across) < 1e-5));
  return tip;
}

test('an advance ping stays on the initially open side as the wagon crosses and stays inside the road edges', (t) => {
  const { draw, mesh } = setup(t);
  for (const side of [-1, 1]) {
    const call = { from: 1, until: 120, movement: 'advance' };
    for (const [runnerX, wagonX] of [
      [0, side * 1.8],
      [side, -side * 1.8],
      [side * RAID_RUN_LIMIT_X, 0],
      [-side * RAID_RUN_LIMIT_X, side * 1.8],
    ]) {
      const runner = { x: runnerX, z: runnerX - 3 };
      draw(call, runner, undefined, wagonX);
      const xs = arrowVertices(mesh).map((point) => point.x);
      assert.ok(xs.every((x) => Math.abs(x) <= RAID_ROAD_WIDTH / 2 + 1e-5));
      const laneX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const offset = laneX - runner.x;
      assert.ok(Math.abs(offset) >= 1 - 1e-5 && Math.abs(offset) <= 2.4 + 1e-5);
      assert.equal(Math.sign(offset), -side, 'hold the side opposite the wagon at the first draw');
      arrowTip(mesh, { x: laneX, z: runner.z }, { x: laneX, z: runner.z + 1 });
    }
    draw(null, { x: 0, z: 0 });
  }
});

test('retreat arrows follow the runner directly backward and reuse one unpickable mesh', (t) => {
  const { scene, draw, mesh } = setup(t);
  assert.equal(mesh.isEnabled(), false);
  assert.equal(mesh.isPickable, false);
  const call = { from: 1, until: 120, movement: 'retreat' };
  let previousTip;
  for (const origin of [
    { x: -1.6, z: -3 },
    { x: 3.5, z: 5 },
  ]) {
    draw(call, origin);
    const tip = arrowTip(mesh, origin, { x: origin.x, z: origin.z - 1 });
    if (previousTip !== undefined) assert.ok(Math.abs(tip - previousTip) < 1e-5);
    previousTip = tip;
    draw(null, origin);
    assert.equal(mesh.isEnabled(), false);
  }
  assert.deepEqual(scene.meshes, [mesh]);
});

test('focus arrows track a moving enemy on either side, shorten at close range and disappear without a direction', (t) => {
  const { draw, mesh } = setup(t);
  const origin = { x: 3, z: -1 };
  const call = { from: 1, until: 120, target: 2 };
  for (const target of [
    { x: -4, z: 2 },
    { x: 7, z: -3 },
    { x: 3.3, z: -0.6 },
  ]) {
    draw(call, origin, target);
    const tip = arrowTip(mesh, origin, target);
    const gap = Math.hypot(target.x - origin.x, target.z - origin.z);
    if (gap < 1) assert.ok(Math.abs(tip - gap) < 1e-5);
    else assert.ok(tip > 1 && tip <= gap + 1e-5);
  }
  for (const target of [origin, undefined]) {
    draw(call, origin, { x: 4, z: 3 });
    assert.ok(mesh.isEnabled());
    draw(call, origin, target);
    assert.equal(mesh.isEnabled(), false);
  }
});

test('each team sees its own replayed call and a fresh round clears a previously visible arrow', (t) => {
  const { draw, mesh } = setup(t);
  const seats = ['hammer', 'jade', 'rend', 'rime'].map((hero, index) => ({
    actor: index + 1,
    hero,
  }));
  const host = new RaidRound(seats);
  const guest = new RaidRound(seats);
  assert.ok(host.enqueue(1, { seq: 1, action: 'call', payload: 'retreat' }));
  assert.ok(host.enqueue(2, { seq: 1, action: 'call', payload: 'enemy1' }));
  assert.ok(guest.replay(host.advance(1)));
  // The other two players receive their teammates' calls.
  for (const actor of [3, 4]) {
    const runner = guest.match.runners[guest.slot(actor)];
    const call = guest.match.calls[runner.team];
    assert.deepEqual(call, host.match.calls[runner.team]);
    if (actor === 3) {
      assert.equal(call.movement, 'retreat');
      draw(call, runner);
      arrowTip(mesh, runner, { x: runner.x, z: runner.z - 1 });
    } else {
      assert.equal(call.target, guest.slot(1));
      const target = guest.match.runners[call.target];
      draw(call, runner, target);
      arrowTip(mesh, runner, target);
    }
  }
  const fresh = new RaidRound(seats);
  const runner = fresh.match.runners[fresh.slot(4)];
  draw(fresh.match.calls[runner.team], runner);
  assert.equal(mesh.isEnabled(), false);
});
