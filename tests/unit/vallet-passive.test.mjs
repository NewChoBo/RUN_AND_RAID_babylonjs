import assert from 'node:assert/strict';
import test from 'node:test';
import { HEROES, RAID_HZ, RaidMatch } from '../../src/game/raid/raid-match.ts';

function practice() {
  const match = new RaidMatch(['vallet', 'hammer', 'alice', 'longshot']);
  for (const r of match.runners) Object.assign(r, { basic: 1000, brake: 0.4, appliedBrake: 0.4 });
  const shooter = match.runners[0];
  Object.assign(shooter, { basic: 0, x: 0, z: 7 });
  const advance = (ticks) => {
    for (let i = 0; i < ticks; i++) match.step();
  };
  const shots = () => match.actions.filter((a) => a.slot === 0 && a.skill === 'basic');
  return { match, shooter, advance, shots };
}

test('each successful cast accelerates actual basic shots and their animation cue by up to three stacks', () => {
  const base = HEROES.vallet.cooldown;
  for (const [stacks, interval] of [
    [0, base],
    [1, 19],
    [2, 15],
    [3, 13],
  ]) {
    const { match, shooter, advance, shots } = practice();
    if (stacks >= 1) assert.ok(match.cast(0, 0, 'wagon'));
    if (stacks >= 2) assert.ok(match.cast(0, 2));
    if (stacks >= 3) assert.ok(match.cast(0, 2));
    assert.equal(shooter.heroView.firingStacks, stacks);
    advance(1);
    assert.equal(shooter.basic, interval);
    assert.equal(shots().at(-1).basicSpeed ?? 1, base / interval);
    const damage = match.damage[0];
    advance(interval - 1);
    assert.equal(shots().length, 1);
    advance(1);
    assert.equal(match.damage[0] - damage, HEROES.vallet.basicAttack);
    assert.deepEqual(
      shots().map((a) => a.tick),
      [1, 1 + interval],
    );
  }
});

test('a real cast speeds up the remaining recovery; invalid input, cooldown and basic hits grant no stacks', () => {
  const { match, shooter, advance, shots } = practice();
  advance(11);
  const remaining = shooter.basic;
  assert.equal(remaining, 14);
  assert.equal(match.cast(0, 0, 1), false);
  assert.equal(match.cast(0, 3, { dx: 1, dz: 0 }), false);
  assert.equal(shooter.basic, remaining);
  assert.equal(shooter.heroView.firingStacks, 0);
  assert.ok(match.cast(0, 0, 'wagon'));
  assert.equal(match.cast(0, 0, 'wagon'), false);
  assert.equal(shooter.heroView.firingStacks, 1);
  assert.equal(shooter.basic, 12);
  advance(12);
  assert.equal(shots().at(-1).tick, 23);
  assert.equal(shooter.heroView.firingStacks, 1);
});

test('casting at the cap refreshes three seconds; automatic landing does not refresh it', () => {
  const { match, shooter, advance } = practice();
  assert.ok(match.cast(0, 0, 'wagon'));
  assert.ok(match.cast(0, 2));
  shooter.rage = 100;
  assert.ok(match.cast(0, 3, { dx: 1, dz: 0 }));
  advance(RAID_HZ);
  assert.ok(match.cast(0, 1, { dx: 1, dz: 0 }));
  assert.equal(shooter.heroView.firingStacks, 3);
  advance(3 * RAID_HZ - 1);
  assert.equal(shooter.heroView.escapeTicks, 0);
  assert.equal(shooter.heroView.firingStacks, 3);
  const remaining = shooter.basic;
  assert.ok(remaining > 1);
  advance(1);
  assert.equal(shooter.heroView.firingStacks, 0);
  assert.equal(shooter.basic, Math.ceil((remaining * HEROES.vallet.cooldown) / 13) - 1);
});

test('knockout clears the firing bonus and escape state before respawn', () => {
  const { match, shooter, advance, shots } = practice();
  const enemy = match.runners[2];
  Object.assign(enemy, { x: 0, z: 5 });
  shooter.hp = 1;
  assert.ok(match.cast(0, 2));
  assert.ok(match.cast(2, 1, 0));
  advance(1);
  assert.ok(shooter.respawn);
  assert.equal(shooter.heroView.firingStacks, 0);
  assert.equal(shooter.heroView.escapeTicks, 0);
  shooter.respawn = 1;
  advance(1);
  Object.assign(shooter, { x: 0, z: 7, basic: 0 });
  advance(1);
  assert.equal(shooter.basic, HEROES.vallet.cooldown);
  assert.equal(shots().at(-1).basicSpeed, undefined);
});
