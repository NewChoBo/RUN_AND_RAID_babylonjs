import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LoadAssetContainerAsync,
  NullEngine,
  Scene,
  StandardMaterial,
  TransformNode,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/index.js';
import { createDrizzHand } from '../../src/platform/babylon/raid/raid-drizz-hand.ts';

test('Drizz throws the original hand from each equipped fighter and reuses its mesh during flight', async (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const rig = new TransformNode('drizz facing', scene);
  const effect = createDrizzHand(scene);
  assert.equal(effect.draw('drizz', 1, 2, 0), false);
  for (const [skin, vertices, triangles] of [
    ['default', 318, 476],
    ['demon', 250, 404],
  ]) {
    const file = new URL('../../public/assets/fighters/drizz-' + skin + '.glb', import.meta.url);
    const model = await LoadAssetContainerAsync(new Uint8Array(readFileSync(file)), scene, {
      pluginExtension: '.glb',
      pluginOptions: { gltf: { animationStartMode: 0, skipMaterials: true } },
    });
    model.addAllToScene();
    model.meshes[0].parent = rig;
    const source = model.meshes.find((mesh) => mesh.skeleton);
    source.material = new StandardMaterial(skin, scene);
    assert.ok(effect.draw('drizz', 1, 2, 0));
    const hand = scene.getMeshByName('Drizz flying hand');
    assert.equal(hand.getTotalVertices(), vertices);
    assert.equal(hand.getTotalIndices(), triangles * 3);
    assert.equal(hand.material, source.material);
    assert.ok(effect.draw('drizz', 4, 6, 1));
    assert.deepEqual(hand.position.asArray(), [4, 1, 6]);
    assert.equal(hand.rotation.y, 1);
    assert.equal(scene.getMeshByName('Drizz flying hand'), hand);
    assert.ok(hand.getBoundingInfo().boundingBox.center.length() < 0.00001);
    effect.hide();
    assert.equal(hand.isEnabled(), false);
    model.dispose();
    assert.equal(effect.draw('drizz', 4, 6, 1), false);
    assert.equal(scene.getMeshByName('Drizz flying hand'), null);
  }
  assert.equal(effect.draw('demonslayer', 4, 6, 1), false);
});
