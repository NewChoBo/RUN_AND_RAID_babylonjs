import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { RaidMatch, raidRespawnTicks, raidRoadTravel } from '../../src/game/raid/raid-match.ts';
import { createRaidCounterVisual } from '../../src/platform/babylon/raid/raid-counter-visual.ts';
import { RaidBoss, RAID_ELECTRIC_GRID } from '../../src/game/raid/raid-boss.ts';
import { ROUND_TICKS } from '../../src/game/raid/raid-rules.ts';
import { createRaidEffects } from '../../src/platform/babylon/raid/raid-effects.ts';

test('an incoming orb keeps its shape at first contact, then its pooled mesh switches to the next skill', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene);
  for (const [hero, material] of [
    ['abyss', 'Abyss dark orb'],
    ['flare', 'Flare fireball'],
  ]) {
    const match = new RaidMatch(['hammer', 'hof', hero, 'jade']);
    const [target, , caster] = match.runners;
    target.x = caster.x - 1.12;
    target.z = caster.z;
    target.stunned = 2;
    for (const runner of match.runners) runner.basic = 999;
    assert.ok(match.cast(caster.slot, 0, { dx: -1, dz: 0 }));
    match.step();
    draw(match, 0.9);
    const body = scene.getMeshByName('raid projectile');
    const [contact] = match.endedProjectiles;
    assert.ok(body.isEnabled());
    assert.equal(body.material.name, material);
    assert.deepEqual(body.position.asArray(), [contact.x, 1, contact.z]);
    if (hero === 'abyss') assert.equal(body.scaling.x, body.scaling.z);
    match.step();
    draw(match, 0);
    assert.ok(!body.isEnabled());
  }
  assert.equal(scene.meshes.filter((m) => m.name === 'raid projectile').length, 1);
});

test('blade waves reuse meshes, keep their contact width and switch between horizontal, upright and cross', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  let rigReady = false;
  const scene = new Scene(engine),
    draw = createRaidEffects(scene, () => rigReady);
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
  rigReady = true;
  draw(match, 0.5);
  assert.ok(!cut.isEnabled());
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

test('Full Moon uses the weapon trail or a road-anchored fallback only while the finisher plays', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  let hasWeapon = false;
  const draw = createRaidEffects(scene, () => hasWeapon);
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
    hasWeapon = true;
    draw(match, 0.5);
    assert.ok(!ring.isEnabled());
    hasWeapon = false;
    match.step();
  }
  draw(match, 0);
  assert.ok(!scene.meshes.some((m) => m.name === 'raid impact rim' && m.isEnabled()));
});

test('Hammer slam follows the authored downswing; a completed impact stays on its road tile', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene);
  const match = new RaidMatch('hammer');
  const hammer = match.runners[0],
    enemy = match.runners[2];
  for (const r of match.runners) r.basic = 999;
  enemy.x = hammer.x;
  enemy.z = hammer.z;
  const hp = enemy.hp;
  assert.ok(match.cast(0, 0));
  const ring = () => scene.meshes.find((m) => m.name === 'raid impact rim' && m.isEnabled());
  while (match.tick < 10) {
    draw(match, 0.9);
    assert.equal(ring(), undefined);
    match.step();
  }
  assert.ok(enemy.hp < hp);
  const hit = { x: hammer.x, z: hammer.z };
  draw(match, 0.5);
  assert.equal(ring().position.x, hit.x);
  assert.equal(ring().position.z, hit.z - raidRoadTravel(0.5));
  match.step();
  // Later skills can supersede the animating caster without lifting this wave off the ground.
  assert.ok(match.cast(0, 2));
  while (match.tick < 27) match.step();
  draw(match, 0.5);
  assert.equal(ring().position.z, hit.z - raidRoadTravel(17.5));
  match.step();
  draw(match, 0);
  assert.equal(ring(), undefined);
});

test('superseding or losing a Hammer swing during wind-up suppresses its cosmetic burst', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene);
  for (const interrupt of ['spin', 'leap', 'death']) {
    const match = new RaidMatch('hammer'),
      hammer = match.runners[0];
    for (const r of match.runners) r.basic = 999;
    assert.ok(match.cast(0, 0));
    for (let i = 0; i < 6; i++) match.step();
    if (interrupt === 'spin') assert.ok(match.cast(0, 2));
    else if (interrupt === 'leap') assert.ok(match.cast(0, 1, { x: 0, z: 1 }));
    else {
      hammer.deaths = 1;
      hammer.respawn = raidRespawnTicks(hammer.deaths);
    }
    while (match.tick < 12) match.step();
    draw(match, 0.5);
    assert.ok(!scene.meshes.some((m) => m.name === 'raid impact rim' && m.isEnabled()), interrupt);
  }
});

test('Hammer landing burst waits one contact frame and melee basics honor attack playback speed', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine),
    draw = createRaidEffects(scene);
  const match = new RaidMatch('hammer');
  for (const r of match.runners) r.basic = 999;
  assert.ok(match.cast(0, 1, { x: 0, z: 1 }));
  while (match.runners[0].leap) match.step();
  const landingTick = match.tick,
    landing = match.actions.at(-1);
  const part = (name) => scene.meshes.find((m) => m.name === name && m.isEnabled());
  draw(match, 0.99);
  assert.equal(part('raid impact rim'), undefined);
  match.step();
  draw(match, 0.5);
  assert.equal(part('raid impact rim').position.z, landing.to.z - raidRoadTravel(1.5));
  assert.equal(match.tick, landingTick + 1);

  for (const [hero, frame] of [
    ['hammer', 7],
    ['kaiken', 6],
  ]) {
    const melee = new RaidMatch(hero);
    for (const r of melee.runners) r.basic = 999;
    const [caster, , target] = melee.runners;
    target.x = caster.x;
    target.z = caster.z + 1;
    caster.basic = 0;
    melee.step();
    const basic = melee.actions.find((a) => a.slot === 0 && a.skill === 'basic');
    assert.ok(basic);
    basic.basicSpeed = 2;
    const contact = basic.tick + frame / 2;
    while (melee.tick < Math.floor(contact - 0.1)) melee.step();
    draw(melee, contact - 0.1 - melee.tick);
    assert.equal(part('raid impact flash'), undefined);
    while (melee.tick < Math.floor(contact)) melee.step();
    draw(melee, contact - melee.tick);
    const flash = part('raid impact flash');
    assert.deepEqual(flash.position.asArray(), [basic.to.x, basic.toY, basic.to.z]);
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

test('electric tells follow road cells and reuse their meshes when switching between ground arcs and pillars', (t) => {
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
  function worldBox(mesh) {
    mesh.computeWorldMatrix(true);
    return mesh.getBoundingInfo().boundingBox;
  }
  function checkGroundArcs(subtick) {
    for (const [i, pool] of pools.entries()) {
      const cell = cells[i];
      assert.deepEqual(
        [pool.parent.position.x, pool.parent.position.z],
        [cell.x, cell.z - raidRoadTravel(subtick)],
      );
      assert.ok(pool.isEnabled() && !pool.isPickable && !pillars[i].isEnabled());
      const { minimumWorld, maximumWorld } = worldBox(pool);
      assert.ok(Math.abs(maximumWorld.x - minimumWorld.x - width) < 1e-6);
      assert.ok(Math.abs(maximumWorld.z - minimumWorld.z - depth) < 1e-6);
      const { pillarWave, groundAspect } = pool.material.serialize().floats;
      assert.equal(pillarWave, 0);
      assert.equal(groundAspect, depth / width);
    }
  }
  checkGroundArcs(0.5);

  const warnings = cells.map((cell) => ({ ...cell, phase: 'warning' }));
  draw({ ...counter, kind: 'pillar', cells: warnings.reverse() }, 0.75);
  assert.ok(pillars[0].isEnabled() && !pillars[0].isPickable && !pillars[1].isEnabled());
  assert.ok(pools[0].isEnabled() && !pools[1].isEnabled());
  assert.equal(pillars[0].parent, pools[0].parent);
  assert.equal(pillars[0].parent.position.z, cells[0].z - raidRoadTravel(0.75));
  assert.equal(pillars[0].material, pools[0].material);
  assert.equal(pools[0].material.serialize().floats.pillarWave, 1);
  const foot = worldBox(pools[0]);
  assert.ok(foot.maximumWorld.x - foot.minimumWorld.x < width * 0.4);
  assert.ok(foot.maximumWorld.z - foot.minimumWorld.z < depth * 0.4);
  const warningColumn = worldBox(pillars[0]);
  const warningWidth = warningColumn.maximumWorld.x - warningColumn.minimumWorld.x;
  const warningHeight = warningColumn.maximumWorld.y - warningColumn.minimumWorld.y;
  assert.ok(warningHeight > warningWidth && warningWidth > 0);
  assert.ok(Math.abs(warningColumn.minimumWorld.y - foot.maximumWorld.y) < 0.05);

  draw({ ...counter, kind: 'pillar' }, 0.75);
  assert.ok(pillars[0].isEnabled() && !pillars[1].isEnabled() && !pools[1].isEnabled());
  const impactColumn = worldBox(pillars[0]);
  assert.ok(impactColumn.maximumWorld.x - impactColumn.minimumWorld.x > warningWidth);
  assert.ok(impactColumn.maximumWorld.y - impactColumn.minimumWorld.y > warningHeight);
  assert.ok(Math.abs(impactColumn.minimumWorld.y - foot.maximumWorld.y) < 0.05);

  draw({ ...counter, cells: cells.slice(0, 1) }, 0.75);
  assert.ok(pools[0].isEnabled() && !pools[1].isEnabled());
  assert.ok(pillars.every((pillar) => !pillar.isEnabled()));
  draw(null, 0);
  assert.ok(scene.meshes.every((mesh) => !mesh.isEnabled()));
  draw(counter, 0);
  checkGroundArcs(0);
  assert.equal(scene.meshes.length, 4);
});

test('straight and zigzag volleys keep their palette while only the leading pillar warning or actual impact cells appear', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const draw = createRaidCounterVisual(scene);
  const boss = new RaidBoss();
  const runners = new RaidMatch().runners;
  const samples = new Map();
  for (let tick = 1; tick < ROUND_TICKS; tick++) {
    boss.step(
      tick,
      runners,
      () => 0,
      () => {},
    );
    const wave = boss.counter;
    if (!wave) continue;
    const key = wave.kind + (wave.zigzag ? '-zigzag' : '-straight');
    if (!samples.has(key)) samples.set(key, { first: wave });
    const sample = samples.get(key);
    if (wave.startedAt !== sample.first.startedAt) continue;
    const impacts = wave.cells.filter((cell) => cell.phase === 'impact');
    if (!sample.warning && !impacts.length && new Set(wave.cells.map((c) => c.row)).size >= 3)
      sample.warning = wave;
    if (
      !sample.mixed &&
      impacts.some((c) => c.ticks === 1) &&
      impacts.some((c) => c.ticks > 2) &&
      wave.cells.some((c) => c.phase === 'warning')
    )
      sample.mixed = wave;
    if (samples.size === 4 && [...samples.values()].every((s) => s.warning && s.mixed)) break;
  }
  assert.deepEqual([...samples.keys()].sort(), [
    'low-straight',
    'low-zigzag',
    'pillar-straight',
    'pillar-zigzag',
  ]);

  function check(wave, expected) {
    const subtick = 0.5;
    draw(wave, subtick);
    const active = scene.meshes.filter((mesh) => mesh.isEnabled());
    const pools = active.filter((mesh) => mesh.name.startsWith('wagon electric pool '));
    const pillars = active.filter((mesh) => mesh.name.startsWith('wagon electric pillar '));
    function meshesAtCells(meshes, cells) {
      assert.equal(meshes.length, cells.length);
      return cells.map((cell) => {
        const z = cell.z - raidRoadTravel(subtick);
        const found = meshes.find(
          (mesh) => mesh.parent.position.x === cell.x && mesh.parent.position.z === z,
        );
        assert.ok(found, 'missing effect at column ' + cell.column + ', row ' + cell.row);
        return found;
      });
    }
    meshesAtCells(pillars, wave.kind === 'pillar' ? expected : []);
    return meshesAtCells(pools, expected).map((pool) => {
      const { colors3, floats } = pool.material.serialize();
      assert.equal(floats.pillarWave, Number(wave.kind === 'pillar'));
      const [r, g, b] = colors3.glowColor;
      const [cr, cg, cb] = colors3.coreColor;
      if (wave.zigzag) {
        assert.ok(g > r && r > b, 'yellow-green branches and pool');
        assert.ok(cr > cb && cg > cb && cr > r, 'pale yellow flash');
      } else {
        assert.deepEqual([r, g, b], [0.12, 0.48, 1]);
        assert.deepEqual([cr, cg, cb], [0.78, 0.96, 1]);
      }
      return floats.strength;
    });
  }
  function checkVolley({ first, warning, mixed }) {
    assert.ok(warning && mixed);
    assert.equal(new Set(first.cells.map((c) => c.row)).size, 1);
    check(first, first.cells);
    // Select by warning deadline and impact phase, independently of mesh allocation order.
    const deadline = Math.min(...warning.cells.map((cell) => cell.ticks));
    const lead = warning.cells.filter((cell) => cell.ticks === deadline);
    const ground = first.kind === 'low';
    const warningStrengths = check(warning, ground ? warning.cells : lead);
    const impact = mixed.cells.filter((cell) => cell.phase === 'impact');
    assert.ok(new Set(impact.map((cell) => cell.row)).size > 1);
    const visible = ground ? mixed.cells : impact;
    const strengths = check(mixed, visible);
    const peak = strengths[visible.findIndex((c) => c.phase === 'impact' && c.ticks > 2)];
    const afterglow = strengths[visible.findIndex((c) => c.phase === 'impact' && c.ticks === 1)];
    assert.ok(Math.max(...warningStrengths) < afterglow && afterglow < peak);
  }
  for (const sample of samples.values()) checkVolley(sample);
  const meshes = [...scene.meshes];
  const materials = [...scene.materials];
  draw(null, 0);
  assert.ok(scene.meshes.every((mesh) => !mesh.isEnabled()));
  for (const sample of [...samples.values()].reverse()) checkVolley(sample);
  assert.deepEqual(scene.meshes, meshes);
  assert.deepEqual(scene.materials, materials);
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
