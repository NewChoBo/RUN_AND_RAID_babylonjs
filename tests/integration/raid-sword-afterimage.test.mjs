import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LoadAssetContainerAsync,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/index.js';
import { ModelMotion } from '../../src/platform/babylon/actors/model-motion.ts';
import { createSwordAfterimage } from '../../src/platform/babylon/raid/raid-sword-afterimage.ts';

test('each afterimage reaches the equipped, animated blade and resets between swings', async (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const actor = new TransformNode('runner', scene);
  actor.position.set(1, 0.4, -3);
  actor.scaling.setAll(0.96);
  actor.rotation.y = 0.6;
  for (const [hero, skin, skill, clip] of [
    ['rildin', 'default', 0, 'pulse'],
    ['kali', 'nurse', 0, 'pulse'],
    ['swift', 'default', 1, 'bolt'],
    ['kaiken', 'sin', 'basic', 'basic'],
  ]) {
    const url = new URL(
      '../../public/assets/fighters/' + hero + '-' + skin + '.glb',
      import.meta.url,
    );
    const asset = await LoadAssetContainerAsync(new Uint8Array(readFileSync(url)), scene, {
      pluginExtension: '.glb',
      pluginOptions: { gltf: { animationStartMode: 0, skipMaterials: true } },
    });
    asset.addAllToScene();
    asset.meshes[0].parent = actor;
    const body = asset.meshes.find((m) => m.skeleton);
    const motion = new ModelMotion(asset.animationGroups, [clip], clip);
    const effect = createSwordAfterimage(hero, asset.meshes);
    assert.ok(effect, hero + ' ' + skin);
    const ribbons = scene.meshes.filter((m) => m.name === hero + ' blade afterimage');
    assert.equal(ribbons.length, hero === 'kali' ? 2 : 1);
    let measured = 0;
    for (let tick = 0; tick <= 20; tick++) {
      motion.once(clip, tick / 30, 1 / 30);
      effect.draw({ skill, id: 1 }, tick, actor.position, hero === 'rildin' && tick >= 5);
      const shown = ribbons.filter((m) => m.isEnabled());
      if (!shown.length) continue;
      body.skeleton.prepare(true);
      const posed = body.getPositionData(true);
      const world = body.computeWorldMatrix(true);
      for (const mesh of shown) {
        if (hero === 'rildin' && tick >= 5) {
          const ink = mesh.getVerticesData(VertexBuffer.ColorKind);
          assert.ok(ink[4] > ink[6], 'empowered blade has a warm edge');
        }
        const tip = Vector3.FromArray(mesh.getVerticesData(VertexBuffer.PositionKind), 3);
        let distance = Infinity;
        for (let i = 0; i < posed.length; i += 3) {
          const vertex = Vector3.TransformCoordinates(Vector3.FromArray(posed, i), world);
          distance = Math.min(distance, Vector3.Distance(vertex, tip));
        }
        assert.ok(distance < 0.001, hero + ' tip offset ' + distance);
        measured++;
      }
    }
    assert.ok(measured > 2, hero + ' motion produced no visible swing');
    actor.position.x += 2.5;
    effect.draw({ skill, id: 1 }, 21, actor.position);
    assert.ok(ribbons.every((m) => !m.isEnabled()));
    for (let tick = 22; tick < 27; tick++) {
      actor.position.x += 0.16;
      effect.draw({ skill, id: 1 }, tick, actor.position);
      assert.ok(ribbons.every((m) => !m.isEnabled()));
    }
    effect.draw({ skill, id: 2 }, 27, actor.position);
    assert.ok(ribbons.every((m) => !m.isEnabled()));
    effect.draw({ skill: 3, id: 3 }, 28, actor.position);
    assert.ok(ribbons.every((m) => !m.isEnabled()));
    let slowFrames = 0;
    for (let frame = 0; frame <= 24; frame += 3) {
      motion.once(clip, frame / 30, 0.1);
      effect.draw({ skill, id: 4 }, 30 + frame, actor.position);
      if (ribbons.some((mesh) => mesh.isEnabled())) slowFrames++;
    }
    assert.ok(slowFrames > 0, 'the stroke is still sampled at 10fps');
    effect.hide();
    effect.dispose();
    assert.ok(ribbons.every((m) => m.isDisposed()));
    asset.dispose();
  }
});
