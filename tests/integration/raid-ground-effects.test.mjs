import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { RaidMatch, raidRoadTravel } from '../../src/game/raid/raid-match.ts';
import { createRaidCounterVisual } from '../../src/platform/babylon/raid/raid-counter-visual.ts';
import { RAID_ELECTRIC_GRID } from '../../src/game/raid/raid-boss.ts';
import { createRaidEffects } from '../../src/platform/babylon/raid/raid-effects.ts';

test('blade waves reuse meshes, keep their contact width and switch between horizontal, upright and cross', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene);
  for (const [hero, skill, form, count, width] of [
    ['kaiken', 0, 'horizontal', 1, 3],
    ['kaiken', 1, 'upright', 3, 1],
    ['swift', 0, 'cross', 1, 3],
  ]) {
    const match = new RaidMatch(hero);
    assert.ok(match.cast(0, skill, { dx: 1, dz: 0 }));
    draw(match, 0);
    const blades = scene.meshes.filter((m) => m.name === 'sword wave' && m.isEnabled());
    assert.equal(blades.length, count);
    assert.ok(
      blades.every(
        (m) => m.scaling.x === width && m.rotation.z === (form === 'upright' ? Math.PI / 2 : 0),
      ),
    );
    assert.ok(Math.abs(blades[Math.floor(count / 2)].parent.rotation.y - Math.PI / 2) < 1e-8);
    assert.equal(
      scene.meshes.filter((m) => m.name === 'crossing sword wave' && m.isEnabled()).length,
      form === 'cross' ? 1 : 0,
    );
  }
  const match = new RaidMatch('swift');
  assert.ok(match.cast(0, 1, 2));
  draw(match, 0);
  const cut = scene.getMeshByName('melee sword trail');
  assert.ok(cut && !cut.isEnabled());
  for (let i = 0; i < 6; i++) match.step();
  draw(match, 0);
  assert.ok(cut.isEnabled());
  draw(new RaidMatch(), 0);
  assert.ok(!cut.isEnabled());
  assert.equal(scene.meshes.filter((m) => m.name === 'sword wave').length, 3);
});

test('Longshot renders seven arrowheads along their shots and rains arrows across the damaging road circle', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene),
    match = new RaidMatch('longshot');
  const point = { x: 2, z: 3 };
  assert.ok(match.cast(0, 0, { dx: 1, dz: 0 }));
  assert.ok(match.cast(0, 1, point));
  const radius = match.skillRange(0, 1).radius;
  draw(match, 0);
  const shots = scene.meshes.filter((m) => m.name === 'raid flying arrow' && m.isEnabled());
  assert.equal(shots.length, 7);
  for (const [i, shot] of shots.entries()) {
    const d = Vector3.TransformNormal(Vector3.Down(), shot.computeWorldMatrix(true));
    assert.ok(Math.hypot(d.x - match.projectiles[i].dx, d.z - match.projectiles[i].dz) < 1e-6);
  }
  for (let i = 0; i <= 45; i++) {
    draw(match, 0);
    if (i % 15 === 0) {
      const ring = scene.meshes.find(
        (m) =>
          m.name === 'raid impact rim' &&
          m.material?.name === 'longshot impact light' &&
          m.isEnabled(),
      );
      const drops = scene.meshes.filter((m) => m.name === 'falling arrow' && m.isEnabled());
      assert.equal(drops.length, 24);
      assert.equal(ring.scaling.x, radius);
      const distances = drops.map(({ position: p }) =>
        Math.hypot(p.x - point.x, p.z + raidRoadTravel(i) + (p.y - 0.09) * 0.22 - point.z),
      );
      assert.ok(
        Math.max(...distances) <= radius &&
          Math.max(...distances) > radius * 0.9 &&
          Math.min(...distances) < radius * 0.2,
      );
    }
    match.step();
  }
  while (match.tick < 49) match.step();
  draw(match, 0);
  assert.ok(
    scene.meshes
      .filter((m) => m.name === 'falling arrow' || m.name === 'raid flying arrow')
      .every((m) => !m.isEnabled()),
  );
});

test('Ignite flames travel with the marked runner and clear on expiry', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene);
  const match = new RaidMatch(['flare', 'hammer', 'hammer', 'jade']);
  for (const r of match.runners) r.basic = 1000;
  const target = match.runners[2];
  target.x = match.runners[0].x;
  target.z = match.runners[0].z + 2;
  assert.ok(match.cast(0, 2, 2));
  draw(match, 0);
  const flames = scene.meshes.filter((m) => m.name === 'ignite flame');
  assert.equal(flames.length, 5);
  target.x += 4;
  match.step();
  draw(match, 0);
  assert.ok(flames.every((m) => m.isEnabled() && Math.abs(m.position.x - target.x) < 0.4));
  while (match.tick < 120) match.step();
  draw(match, 0);
  assert.ok(flames.every((m) => !m.isEnabled()));
});

test('Dark Blades follows the moving caster, layers two cuts and finishes with the pale sweep', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene),
    match = new RaidMatch('kali');
  const r = match.runners[0];
  r.rage = 100;
  assert.ok(match.cast(0, 3, { dx: 1, dz: 0 }));
  for (const tick of [5, 21, 28]) {
    while (match.tick < tick) match.step();
    draw(match, 0);
    const root = scene.getTransformNodeByName('shadow blades');
    const active = root.getChildMeshes().filter((m) => m.isEnabled());
    if (tick === 28) assert.equal(active.length, 0);
    else {
      assert.deepEqual([root.position.x, root.position.z], [r.x, r.z]);
      assert.equal(active.length, tick === 5 ? 2 : 1);
      if (tick === 21) assert.equal(active[0].material.emissiveColor.toHexString(), '#FFF3FF');
    }
  }
});

test('Full Moon spin and its impact ring stay on the road tile where the backward dash stopped', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const draw = createRaidEffects(scene);
  const match = new RaidMatch('kaiken');
  assert.ok(match.cast(0, 0, { dx: 0, dz: -1 }));
  assert.ok(match.cast(0, 2));
  for (let tick = 0; tick < 4; tick++) match.step();
  assert.ok(match.cast(0, 2));
  const spin = match.actions.at(-1);
  assert.equal(spin.phase, 'spin');
  for (let age = 0; age < 16; age++) {
    draw(match, 0.5);
    const ring = scene.meshes.find(
      (mesh) =>
        mesh.name === 'raid impact rim' &&
        mesh.isEnabled() &&
        mesh.material?.name === 'kaiken impact light',
    );
    assert.ok(ring);
    assert.equal(ring.position.x, spin.to.x);
    assert.ok(Math.abs(ring.position.z + raidRoadTravel(age + 0.5) - spin.to.z) < 1e-8);
    assert.ok(Math.abs(ring.position.z + raidRoadTravel(0.5) - match.runners[0].z) < 1e-8);
    match.step();
  }
});

test('Chain Slash draws the frontal sector at its cast-time reach even after a later empowerment', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const draw = createRaidEffects(scene);
  const match = new RaidMatch('rildin');
  assert.ok(match.cast(0, 0));
  const slash = match.actions[0];
  match.runners[0].rage = 100;
  assert.ok(match.cast(0, 3));
  assert.equal(match.previewSkill(0, 0, null).radius, 6.5);
  assert.deepEqual(slash.footprint, { radius: 5, halfAngle: Math.PI / 4 });
  for (let tick = 0; tick < 6; tick++) match.step();
  draw(match, 0);
  const rim = scene.getMeshByName('skill sector rim');
  assert.ok(rim.isEnabled());
  assert.equal(rim.scaling.x, 5);
  assert.ok(Math.abs(rim.getBoundingInfo().boundingBox.maximum.x - Math.sin(Math.PI / 4)) < 1e-6);
  assert.equal(rim.getBoundingInfo().boundingBox.minimum.z, 0);
});

test('electric tells follow individual road cells, raise pillars only on impact and reuse their meshes', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const draw = createRaidCounterVisual(scene);
  const { width, depth } = RAID_ELECTRIC_GRID;
  const cells = [
    { row: 10, column: 2, x: 0, z: 1.5, phase: 'impact', ticks: 3 },
    { row: 11, column: 3, x: width, z: 1.5 + depth, phase: 'warning', ticks: 10 },
  ];
  const counter = { kind: 'low', startedAt: 20, zigzag: false, cells };
  draw(counter, 0.5);
  const pools = cells.map((_, i) => scene.getMeshByName('wagon electric pool ' + i));
  const pillars = cells.map((_, i) => scene.getMeshByName('wagon electric pillar ' + i));
  for (const [i, pool] of pools.entries()) {
    const cell = cells[i];
    assert.deepEqual(
      [pool.parent.position.x, pool.parent.position.z],
      [cell.x, cell.z - raidRoadTravel(0.5)],
    );
    assert.ok(pool.isEnabled() && !pool.isPickable && !pillars[i].isEnabled());
    const { minimum, maximum } = pool.getBoundingInfo().boundingBox;
    assert.ok(Math.abs(maximum.x - minimum.x - width) < 1e-6);
    assert.ok(Math.abs(maximum.z - minimum.z - depth) < 1e-6);
  }
  draw({ ...counter, kind: 'pillar', zigzag: true }, 0.75);
  assert.ok(pillars[0].isEnabled() && !pillars[1].isEnabled());
  assert.equal(pillars[0].parent, pools[0].parent);
  assert.equal(pillars[0].parent.position.z, cells[0].z - raidRoadTravel(0.75));
  draw({ ...counter, cells: cells.slice(0, 1) }, 0.75);
  assert.ok(pools[0].isEnabled() && !pools[1].isEnabled());
  assert.ok(pillars.every((pillar) => !pillar.isEnabled()));
  draw(null, 0);
  assert.ok(scene.meshes.every((mesh) => !mesh.isEnabled()));
  draw(counter, 0);
  assert.equal(scene.meshes.length, 4);
});

test('persistent ground rings and sigils stay on the same road tile between ticks and across bridge spans', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const renderEffects = createRaidEffects(scene);
  const match = new RaidMatch(['hammer', 'abyss', 'longshot', 'freesia']);
  while (match.tick < 38) match.step();
  const aim = { x: 0.8, z: 7 };
  const roadZ = aim.z + raidRoadTravel(match.tick);
  const casters = match.runners.filter((runner) => runner.hero !== 'hammer');
  for (const caster of casters)
    assert.ok(match.cast(caster.slot, caster.hero === 'freesia' ? 0 : 1, aim));
  for (const now of [38, 38.5, 38.5, 40, 53, 68]) {
    while (match.tick < Math.floor(now)) match.step();
    renderEffects(match, now - match.tick);
    for (const caster of casters) {
      for (const [name, surface] of [
        ['raid ground sigil', 'particle ink'],
        ['raid impact rim', 'impact light'],
      ]) {
        const part = scene.meshes.find(
          (mesh) =>
            mesh.name === name &&
            mesh.isEnabled() &&
            mesh.material?.name === caster.hero + ' ' + surface,
        );
        assert.ok(part, caster.hero + ' ' + name);
        assert.equal(part.position.x, aim.x);
        assert.ok(Math.abs(part.position.z + raidRoadTravel(now) - roadZ) < 1e-6);
      }
    }
  }
});
