import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Animation,
  AnimationGroup,
  NullEngine,
  Scene,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { ModelMotion } from '../../src/platform/babylon/actors/model-motion.ts';
import { RaidActionPlayback } from '../../src/platform/babylon/raid/raid-action-playback.ts';

test('a take samples its authored time and clamps at its last key', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    node = new TransformNode('hand', scene);
  const group = new AnimationGroup('basic', scene);
  const animation = new Animation('move', 'position', 30, Animation.ANIMATIONTYPE_VECTOR3);
  animation.setKeys([
    { frame: 10, value: Vector3.Zero() },
    { frame: 70, value: new Vector3(12, 0, 0) },
  ]);
  group.addTargetedAnimation(animation, node);
  const motion = new ModelMotion([group], ['basic']);
  assert.equal(motion.duration('basic'), 2);
  motion.once('basic', 0.5, 1);
  assert.equal(node.position.x, 3);
  motion.once('basic', 3, 1);
  assert.equal(node.position.x, 12);
  // Some archive models retain a single source take without designated gait names.
  group.name = 'Animation';
  const archive = new ModelMotion([group], ['Animation'], 'Animation');
  assert.equal(archive.duration('run'), 2);
  archive.loop('walk', 2.5, 1);
  assert.equal(node.position.x, 3);
  archive.gait('run', 0.35, 1, 0.7);
  assert.equal(node.position.x, 6);
  // Apply braking halfway through the stride, then continue at the source clip's speed.
  archive.gait('walk', 0.35, 1);
  assert.equal(node.position.x, 6);
  archive.gait('walk', 0.85, 1);
  assert.equal(node.position.x, 9);
});

test('attack speed modifies only the affected take and a cancelled charge stops between frames', () => {
  const player = new RaidActionPlayback();
  const resolve = (cue) => ({ clip: String(cue.skill), duration: 1, start: cue.tick });
  const buffed = { id: 1, slot: 0, tick: 0, skill: 'basic', basicSpeed: 2 };
  assert.equal(player.update([buffed], 0, 0, resolve).end, 15);
  const normal = { id: 2, slot: 0, tick: 15, skill: 'basic' };
  assert.equal(player.update([normal], 0, 15, resolve).end, 45);
  const charge = { id: 3, slot: 0, tick: 22, skill: 3 };
  assert.equal(player.update([charge], 0, 23, resolve).cue, charge);
  charge.cancelledAt = 26;
  assert.equal(player.update([], 0, 28, resolve), undefined);
});

test('a take survives action-history expiry and a new cast can interrupt recovery', () => {
  const player = new RaidActionPlayback();
  const resolve = (cue) => ({ clip: String(cue.skill), duration: 2, start: cue.tick });
  const cast = { id: 1, slot: 0, tick: 0, skill: 2 };
  const basic = { id: 2, slot: 0, tick: 5, skill: 'basic' };
  assert.equal(player.update([cast, basic], 0, 5, resolve).cue.id, 1);
  assert.equal(player.update([{ ...basic, id: 3, tick: 40 }], 0, 40, resolve).cue.id, 1);
  assert.equal(player.update([], 0, 45, resolve).cue.id, 1);
  assert.equal(player.update([], 0, 60, resolve), undefined);
  const next = { id: 4, tick: 61, skill: 0, slot: 0 },
    cancel = { id: 5, tick: 64, skill: 1, slot: 0 };
  assert.equal(player.update([next, cancel], 0, 61, resolve).cue.id, 4);
  assert.equal(player.update([next, cancel], 0, 64, resolve).cue.id, 5);
  assert.equal(player.update([next, cancel], 0, 125, resolve), undefined);
  assert.equal(player.update([cast], 0, 0, resolve).cue.id, 1);
});

test('basic attacks leave the end of their take free for locomotion during attack recovery', () => {
  const player = new RaidActionPlayback();
  const resolve = (cue) => ({ clip: 'basic', duration: 1, start: cue.tick });
  const first = { id: 1, slot: 0, tick: 0, skill: 'basic' };
  const next = { ...first, id: 2, tick: 34 };
  assert.equal(player.update([first, next], 0, 29, resolve).cue, first);
  assert.equal(player.update([first, next], 0, 30, resolve), undefined);
  assert.equal(player.update([first, next], 0, 33.9, resolve), undefined);
  assert.equal(player.update([first, next], 0, 34, resolve).start, 34);
});

test('an early follow-up starts on the actual strike and is never replayed after the last take', () => {
  const player = new RaidActionPlayback();
  const resolve = (cue) => ({ clip: 'basic', duration: 1, start: cue.tick });
  const basics = [0, 8, 16].map((tick, id) => ({ id: id + 1, slot: 0, tick, skill: 'basic' }));
  assert.equal(player.update(basics, 0, 20, resolve).start, 16);
  assert.equal(player.update([], 0, 30, resolve).start, 16);
  assert.equal(player.update([], 0, 46, resolve), undefined);
});
