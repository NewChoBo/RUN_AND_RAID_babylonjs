import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LoadAssetContainerAsync,
  Matrix,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/index.js';
import { ModelMotion } from '../../src/platform/babylon/actors/model-motion.ts';
import { createSwordAfterimage } from '../../src/platform/babylon/raid/raid-sword-afterimage.ts';

test('sweeps round between measured poses while thrusts, stops and reversals stay on their line', async (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const asset = await LoadAssetContainerAsync(
    new Uint8Array(
      readFileSync(new URL('../../public/assets/fighters/hammer-default.glb', import.meta.url)),
    ),
    scene,
    {
      pluginExtension: '.glb',
      pluginOptions: { gltf: { animationStartMode: 0, skipMaterials: true } },
    },
  );
  asset.addAllToScene();
  const pose = new TransformNode('controlled weapon motion', scene);
  asset.meshes[0].parent = pose;
  const effect = createSwordAfterimage('hammer', asset.meshes);
  const ribbon = scene.getMeshByName('hammer blade afterimage');
  const origin = Vector3.Zero();
  const swing = { id: 1, skill: 'basic' };
  const edge = (row, side) =>
    Vector3.FromArray(ribbon.getVerticesData(VertexBuffer.PositionKind), row * 6 + side * 3);
  const close = (a, b) => assert.ok(Vector3.Distance(a, b) < 1e-5, `${a} vs ${b}`);
  const radius = 1.2;
  const orbit = (time) =>
    new Vector3(radius * Math.cos(time * 0.6), 0, radius * Math.sin(time * 0.6));
  // Uneven gaps between poses, all large enough to be retained in the history.
  const times = [0, 0.8, 1.45, 2.7];
  for (const time of times) {
    pose.position.copyFrom(orbit(time));
    effect.draw(swing, time, origin);
  }
  assert.ok(ribbon.isEnabled());
  const offsets = [0, 1].map((side) => edge(0, side).subtract(pose.position));
  for (const [side, offset] of offsets.entries()) {
    for (const [i, time] of times.toReversed().entries())
      close(edge(i * 4, side), orbit(time).add(offset));
    // The interior strike should follow the circle more closely than the old flat facet.
    const chordMid = Vector3.Center(orbit(times[1]), orbit(times[2]));
    const mid = edge(6, side).subtract(offset);
    assert.ok(Math.abs(radius - mid.length()) < (radius - chordMid.length()) * 0.6);
  }

  const thrust = { id: 2, skill: 'basic' };
  const distances = [0, 0.35, 1, 1, 0.35, 0];
  const axis = new Vector3(1, 0.3, -0.7);
  for (const [i, distance] of distances.entries()) {
    pose.position.copyFrom(axis.scale(distance));
    effect.draw(thrust, 3 + i, origin);
    if (!i) assert.equal(ribbon.isEnabled(), false);
  }
  assert.ok(ribbon.isEnabled());
  const history = distances.toReversed();
  for (const [side, offset] of offsets.entries()) {
    for (let span = 0; span < 4; span++) {
      const start = history[span],
        end = history[span + 1];
      for (let part = 0; part <= 4; part++) {
        const point = edge(span * 4 + part, side).subtract(offset);
        assert.ok(point.x >= Math.min(start, end) - 1e-5 && point.x <= Math.max(start, end) + 1e-5);
        close(point, axis.scale(point.x));
      }
    }
  }
  pose.position.copyFrom(axis.scale(3));
  effect.draw(thrust, 20, origin);
  assert.equal(ribbon.isEnabled(), false, 'do not bridge a long frame gap');
  // At 10 FPS, the four-tick tail falls between the samples at ticks 20 and 23.
  for (const time of [23, 26]) {
    pose.position.copyFrom(axis.scale(time - 17));
    effect.draw(thrust, time, origin);
  }
  assert.ok(ribbon.isEnabled());
  const colors = ribbon.getVerticesData(VertexBuffer.ColorKind);
  for (const [side, offset] of offsets.entries()) {
    close(edge(colors.length / 8 - 1, side), axis.scale(5).add(offset));
    assert.equal(colors[colors.length - 5 + side * 4], 0);
  }

  // Identical tip samples form hard corners on a thrust, but a circular sweep on a turning weapon.
  const angle = (110 * Math.PI) / 180;
  const tipAt = (frame) =>
    Vector3.TransformCoordinates(offsets[1], Matrix.RotationY(frame * angle));
  const chord = Vector3.Center(tipAt(1), tipAt(2));
  for (const rotate of [false, true]) {
    const cue = { id: rotate ? 4 : 3, skill: 'basic' };
    for (let frame = 0; frame < 4; frame++) {
      pose.rotation.y = rotate ? frame * angle : 0;
      pose.position.copyFrom(rotate ? origin : tipAt(frame).subtract(offsets[1]));
      effect.draw(cue, 28 + frame, origin);
    }
    close(edge(4, 1), tipAt(2));
    close(edge(8, 1), tipAt(1));
    const mid = edge(6, 1);
    if (rotate) {
      const arc = tipAt(1.5);
      assert.ok(Vector3.Distance(mid, arc) < Vector3.Distance(chord, arc) * 0.6);
    } else close(mid, chord);
  }
});

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

test('Hammer sweeps and Kaiken spins trace both edges on every equipped weapon', async (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const actor = new TransformNode('moving runner', scene);
  actor.scaling.setAll(0.96);
  for (const [hero, skins] of [
    ['hammer', ['default', 'doomguard', 'royalguard', 'warmachine']],
    ['kaiken', ['default', 'onimusha', 'sin', 'suit']],
  ]) {
    for (const skin of skins) {
      const file = new URL(`../../public/assets/fighters/${hero}-${skin}.glb`, import.meta.url);
      const asset = await LoadAssetContainerAsync(new Uint8Array(readFileSync(file)), scene, {
        pluginExtension: '.glb',
        pluginOptions: { gltf: { animationStartMode: 0, skipMaterials: true } },
      });
      asset.addAllToScene();
      asset.meshes[0].parent = actor;
      const body = asset.meshes.find((mesh) => mesh.skeleton);
      const bone = body.skeleton.bones.find(
        (b) => b.name === (hero === 'hammer' ? 'wp_bn' : 'Bip001 Prop1'),
      );
      const joints = body.getVerticesData(VertexBuffer.MatricesIndicesKind);
      const weights = body.getVerticesData(VertexBuffer.MatricesWeightsKind);
      const weapon = [];
      for (let i = 0; i < joints.length; i += 4) {
        if (joints[i] === bone.getIndex() && weights[i] >= 0.99) weapon.push((i / 4) * 3);
      }
      const effect = createSwordAfterimage(hero, asset.meshes);
      const ribbon = scene.getMeshByName(hero + ' blade afterimage');
      const motions =
        hero === 'hammer'
          ? [
              ['field', { remaining: 60, skill: 2 }],
              ['basic', { id: 2, skill: 'basic' }],
              ['pulse', { id: 3, skill: 0 }],
            ]
          : [
              ['fullMoonEnd', { id: 4, skill: 2, phase: 'spin' }],
              ['fury', { remaining: 75, skill: 3 }],
            ];
      const motion = new ModelMotion(
        asset.animationGroups,
        motions.map(([clip]) => clip),
        motions[0][0],
      );
      for (const [clip, swing] of motions) {
        for (const fps of [30, 60, 120]) {
          let verified = 0;
          for (let frame = 0; frame < fps / 2; frame++) {
            const seconds = frame / fps;
            actor.position.set(1 + seconds, 0.2, -3);
            actor.rotation.y = seconds * 0.7;
            motion.once(clip, seconds, 1 / fps);
            effect.draw(swing, seconds * 30, actor.position);
            if (!ribbon.isEnabled() || frame % (fps / 30)) continue;
            const edge = ribbon.getVerticesData(VertexBuffer.PositionKind);
            body.skeleton.prepare(true);
            const posed = body.getPositionData(true);
            const world = body.computeWorldMatrix(true);
            for (const offset of [0, 3]) {
              const point = Vector3.FromArray(edge, offset);
              assert.ok(
                weapon.some(
                  (i) =>
                    Vector3.DistanceSquared(
                      point,
                      Vector3.TransformCoordinates(Vector3.FromArray(posed, i), world),
                    ) < 1e-6,
                ),
                `${hero} ${skin} ${clip} ${fps}fps edge ${offset}`,
              );
            }
            verified++;
          }
          assert.ok(verified >= 2, `${hero} ${skin} ${clip} ${fps}fps missing stroke`);
          // An old cast cue may still be in the event log after cancelling the spin.
          effect.draw({ id: 5, skill: 2 }, 15, actor.position);
          assert.equal(ribbon.isEnabled(), false);
        }
      }
      effect.dispose();
      asset.dispose();
    }
  }
});
