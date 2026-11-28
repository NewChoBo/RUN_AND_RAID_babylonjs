import assert from 'node:assert/strict';
import test from 'node:test';
import { Mesh, MeshBuilder, NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { placeSourceModel } from '../../src/platform/babylon/raid/source-model-size.ts';
import {
  RAID_RIG_SCALE,
  RAID_RUNNER_SCALE,
} from '../../src/platform/babylon/raid/hero-appearance.ts';

test('the course preserves Player body and equipment dimensions across runners and outfits', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const runner = new TransformNode('runner', scene);
  runner.scaling.setAll(RAID_RUNNER_SCALE);
  const rig = new TransformNode('facing', scene);
  rig.parent = runner;
  rig.scaling.setAll(RAID_RIG_SCALE);
  for (const [id, height, width, factor] of [
    ['kaiken/default', 1.9337, 1.2, 1],
    ['magnus/default', 2.6969, 3.4, 1],
    ['magnus/armoredforces', 2.4135, 5.1, 1],
    ['bird/default', 0.9907, 4.32, 1],
    ['goblin/default', 30.344, 102.38, 0.02],
    ['shaman/default', 17.212, 19.68, 0.1],
    [undefined, 2, 4, 1],
  ]) {
    const root = new Mesh('GLB', scene);
    root.scaling.z = -1;
    const body = MeshBuilder.CreateBox('body', { height, width, depth: 1 }, scene);
    body.parent = root;
    body.position.y = -3;
    const size = placeSourceModel(root, id);
    root.parent = rig;
    const { min, max } = root.getHierarchyBoundingVectors(true);
    const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, id + ' ' + a + ' vs ' + b);
    close(min.y, 0);
    close(max.y, height * factor);
    close(max.x - min.x, width * factor);
    close(size.y * RAID_RIG_SCALE * RAID_RUNNER_SCALE, max.y);
    assert.ok(root.scaling.z < 0);
  }
});
