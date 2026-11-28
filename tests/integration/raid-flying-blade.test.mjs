import assert from 'node:assert/strict';
import test from 'node:test';
import { FreeCamera, NullEngine, Scene, Vector3, VertexBuffer, Viewport } from '@babylonjs/core';
import { RAID_CAMERA, raidCameraPose } from '../../src/game/raid/raid-sight.ts';
import { createFlyingBlade } from '../../src/platform/babylon/raid/raid-blade-wave.ts';

test('an upright sword wave flying straight at the chase camera has a visible width', (t) => {
  const viewport = new Viewport(0, 0, 844, 390);
  const engine = new NullEngine({ renderWidth: viewport.width, renderHeight: viewport.height });
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const { eye, look } = raidCameraPose({ x: 0, z: 0 });
  const camera = new FreeCamera('chase', new Vector3(eye.x, eye.y, eye.z), scene);
  camera.fov = RAID_CAMERA.fov;
  camera.setTarget(new Vector3(look.x, look.y, look.z));
  const view = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));

  createFlyingBlade(scene).draw('upright', 0, 5, Math.PI, 1);
  const blade = scene.getMeshByName('sword wave');
  const world = blade.computeWorldMatrix(true);
  const vertices = blade.getVerticesData(VertexBuffer.PositionKind);
  const x = [];
  for (let i = 0; i < vertices.length; i += 3) {
    x.push(Vector3.Project(Vector3.FromArray(vertices, i), world, view, viewport).x);
  }
  assert.ok(Math.max(...x) - Math.min(...x) >= 2);
});
