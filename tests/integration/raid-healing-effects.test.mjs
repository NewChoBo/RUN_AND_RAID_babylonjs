import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Scene } from '@babylonjs/core';
import { RaidMatch } from '../../src/game/raid/raid-match.ts';
import { RAID_KO_HEAL_TRAVEL } from '../../src/game/raid/raid-rules.ts';
import { createRaidHealingEffects } from '../../src/platform/babylon/raid/raid-healing-effects.ts';

function setup(t) {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  const scene = new Scene(engine);
  const draw = createRaidHealingEffects(scene);
  const match = new RaidMatch(['hammer', 'theresa', 'swift', 'freesia']);
  for (const r of match.runners) r.basic = 999;
  const render = (reduced = false) => draw(match, match.runners, 0, 0, () => 2, reduced);
  const enabled = (name) => scene.meshes.filter((mesh) => mesh.name === name && mesh.isEnabled());
  return { match, scene, render, enabled };
}

test('knockout light arcs from the fallen runner and gives way to a single pulse on the moving recipient', (t) => {
  const { match, scene, render, enabled } = setup(t);
  const [killer, , victim, other] = match.runners;
  killer.hp -= 4;
  Object.assign(killer, { x: -2, z: 0 });
  Object.assign(victim, { x: 2, z: 0, hp: 1 });
  other.x = 6;
  assert.ok(match.cast(killer.slot, 0));
  match.step();
  render();
  const [flight] = match.healingFlights;
  const [mote] = enabled('healing energy mote');
  assert.deepEqual(mote.position.asArray(), [flight.x, flight.elevation + 1, flight.z]);
  assert.equal(enabled('healing pulse').length, 0);
  assert.equal(enabled('healing energy trail').length, 1);
  render(true);
  assert.equal(enabled('healing energy mote').length, 0);
  while (match.tick < flight.started + RAID_KO_HEAL_TRAVEL / 2) match.step();
  render();
  assert.ok(mote.position.y > 2);
  const mid = mote.position.clone();
  const meshCount = scene.meshes.length;
  render();
  assert.ok(mid.equals(mote.position), 're-rendering a paused tick does not advance the flight');
  assert.equal(scene.meshes.length, meshCount);
  killer.x = -5;
  while (match.tick < flight.arrives - 1) match.step();
  render();
  assert.ok(Math.abs(mote.position.x - killer.x) < 0.5);
  match.step();
  render();
  assert.equal(enabled('healing energy mote').length, 0);
  assert.equal(enabled('healing energy trail').length, 0);
  const [pulse] = enabled('healing pulse');
  assert.equal(pulse.position.x, killer.x);
  assert.equal(pulse.position.z, killer.z);
  assert.equal(enabled('healing arrival glow').length, 1);
  render(true);
  assert.ok(pulse.isEnabled());
  assert.equal(enabled('healing arrival glow').length, 0);
  for (let i = 0; i < 16; i++) match.step();
  render();
  assert.equal(enabled('healing pulse').length, 0);
});

test('Theresa heals herself and her injured ally immediately, with no KO flight or effect for overheal', (t) => {
  for (const missing of [0, 6]) {
    const { match, render, enabled } = setup(t);
    const [ally, caster] = match.runners;
    caster.x = ally.x;
    caster.z = ally.z;
    caster.hp -= missing;
    ally.hp -= missing;
    assert.ok(match.cast(caster.slot, 0));
    render();
    assert.equal(enabled('healing energy mote').length, 0);
    assert.equal(enabled('healing pulse').length, missing ? 2 : 0);
    caster.respawn = 50;
    render();
    assert.equal(enabled('healing pulse').length, missing ? 1 : 0);
  }
});
