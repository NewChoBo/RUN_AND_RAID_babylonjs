import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidMatch, HEROES, ROUND_TICKS, RAID_HZ } from '../../src/game/raid/raid-match.ts';
import { practiceRoster, applyPick } from '../../src/game/raid/raid-draft.ts';
import { RaidSimulation } from '../../src/game/raid/raid-simulation.ts';
import { driveRaidBots } from '../../src/game/raid/raid-bots.ts';
import { HERO_IDS, ORIGINAL_HERO_IDS, borrowedKits } from '../../src/game/raid/heroes/hero-id.ts';

function arena(hero) {
  const match = new RaidMatch([hero, 'jade', 'abyss', 'longshot']);
  for (const r of match.runners)
    Object.assign(r, { basic: 10000, x: 0, z: 0, brake: 0.4, appliedBrake: 0.4 });
  match.runners[2].z = 4;
  match.runners[3].x = 6;
  return match;
}
function advance(match, n) {
  for (let i = 0; i < n; i++) match.step();
}

test('Drizz pulls a rival, launches them, lands from his own jump and punches through a shield', () => {
  const m = arena('drizz');
  const [r, , enemy] = m.runners;
  assert.ok(m.cast(0, 0, { dx: 0, dz: 1 }));
  advance(m, 8);
  assert.ok(enemy.silenced > 0 && Math.hypot(enemy.x - r.x, enemy.z - r.z) <= 1.01);
  assert.ok(m.cast(0, 1));
  m.step();
  assert.ok(enemy.jumping > 0 && enemy.staggered > 0);
  assert.equal(m.cast(0, 2), false);
  assert.ok(m.jump(0));
  assert.ok(m.cast(0, 2));
  assert.equal(r.jumping, 0);
  m.step();
  assert.ok(enemy.slowed > 0);
  const n = arena('drizz');
  const target = n.runners[2];
  target.shield = 75;
  n.runners[0].rage = 100;
  assert.ok(n.cast(0, 3, 2));
  advance(n, 6);
  assert.equal(HEROES.abyss.hp - target.hp, HEROES.drizz.power * 6);
});

test('Alice can heal or ward herself and her partner, silence or slow enemies, and repel grounded targets', () => {
  const m = arena('alice');
  const [r, ally, enemy] = m.runners;
  ally.hp -= 40;
  assert.ok(m.cast(0, 1, 1));
  assert.equal(ally.hp, HEROES.jade.hp - 15);
  assert.ok(m.cast(0, 2, 1));
  assert.equal(ally.barrier.amount, 20);
  assert.ok(m.cast(2, 1, 1));
  m.step();
  assert.equal(ally.barrier, null);
  assert.ok(ally.hp < HEROES.jade.hp - 15);
  r.cooldowns[1] = r.cooldowns[2] = 0;
  assert.ok(m.cast(0, 1, 2));
  assert.ok(m.cast(0, 2, 2));
  m.step();
  assert.ok(enemy.silenced && enemy.slowed);
  assert.ok(m.cast(0, 0));
  m.step();
  assert.ok(enemy.z > 6);
  const n = arena('alice');
  n.runners[2].jumping = 12;
  assert.ok(n.cast(0, 0));
  n.step();
  assert.equal(n.runners[2].hp, HEROES.abyss.hp);
  n.runners[0].hp -= 40;
  assert.ok(n.cast(0, 1, 0));
  assert.equal(n.runners[0].hp, HEROES.alice.hp - 15);
});

test('Holy Orb follows Alice for five pulses, healing allies and resisting control until it ends', () => {
  const m = arena('alice');
  const [r, ally, enemy] = m.runners;
  r.rage = 100;
  ally.hp = 5;
  ally.x = 4;
  enemy.x = 3;
  enemy.z = -25;
  assert.ok(m.cast(0, 3));
  assert.equal(m.jump(0), false);
  advance(m, RAID_HZ);
  assert.equal(ally.hp, 17);
  enemy.z = r.z + 1;
  assert.ok(m.cast(2, 1, 0));
  m.step();
  assert.equal(r.silenced, 0);
  const before = enemy.hp;
  advance(m, 4 * RAID_HZ - 1);
  assert.equal(ally.hp, 65);
  assert.equal(before - enemy.hp, 4 * 14);
  assert.ok(m.jump(0));
  advance(m, RAID_HZ);
  assert.equal(ally.hp, 65);
});

test('Alice bot prioritizes a wounded partner', () => {
  const m = arena('alice');
  m.runners[1].hp = 35;
  advance(m, 32);
  driveRaidBots(
    m,
    (slot, action, payload) => {
      if (slot === 0 && action === 'cast') assert.deepEqual(payload, { skill: 1, target: 1 });
      if (slot === 0 && action === 'cast') m.cast(slot, payload.skill, payload.target);
    },
    new Set([1, 2, 3]),
  );
  assert.equal(m.runners[1].hp, 60);
});

test('Froze spends ice crystals, flashes only chilled targets and absorbs one hostile skill', () => {
  const m = arena('froze'),
    [r, , enemy] = m.runners;
  const hp = enemy.hp;
  assert.ok(m.cast(0, 1));
  m.step();
  assert.equal(enemy.hp, hp);
  assert.ok(m.cast(0, 0, { dx: 0, dz: 1 }));
  advance(m, 25);
  assert.equal(r.heroView.iceCrystals, 1);
  assert.equal(m.cast(0, 1), false);
  advance(m, 34);
  assert.equal(r.heroView.iceCrystals, 2);
  assert.ok(m.cast(0, 1));
  m.step();
  assert.ok(enemy.hp < hp - 30);
  assert.ok(m.cast(0, 2));
  const start = r.hp;
  assert.ok(m.cast(2, 1, 0));
  m.step();
  assert.equal(r.hp, start);
  assert.equal(r.silenced, 0);
});

test('Magnus changes modes without rage and forces nearby rivals to focus him', () => {
  const m = arena('magnus'),
    [r, , enemy] = m.runners;
  enemy.z = 2;
  assert.equal(r.rage, 0);
  assert.ok(m.cast(0, 3));
  assert.ok(r.heroView.shieldMode);
  assert.ok(m.cast(0, 1));
  m.step();
  assert.equal(enemy.taunt.from, 0);
  assert.equal(m.cast(2, 1, 0), false);
  r.hp -= 30;
  const hp = r.hp;
  assert.ok(m.cast(0, 2));
  assert.ok(r.hp > hp);
  assert.ok(m.cast(0, 0));
  assert.ok(r.dash);
  advance(m, 8);
  assert.equal(r.dash, null);
  advance(m, 112);
  assert.ok(m.cast(0, 3));
  assert.equal(r.heroView.shieldMode, false);
});

test('all playable profiles enter practice with their own identity and every bot uses its whole kit', () => {
  assert.equal(ORIGINAL_HERO_IDS.length, 17);
  assert.equal(Object.keys(borrowedKits).length, 13);
  for (const hero of HERO_IDS) {
    const seats = [{ actor: 1, hero: null }];
    assert.ok(applyPick(seats, 1, hero));
    const roster = practiceRoster(seats[0].hero);
    assert.equal(new Set(roster).size, 4);
    const match = new RaidMatch(roster),
      sim = new RaidSimulation(match, new Set());
    assert.equal(match.runners[0].hero, hero);
    const used = new Set();
    while (!match.result && match.tick < ROUND_TICKS) {
      sim.step();
      for (const a of match.actions) if (a.slot === 0) used.add(a.skill);
    }
    assert.ok(match.result);
    assert.deepEqual([...used].sort(), [0, 1, 2, 3, 'basic'].sort(), hero);
    assert.ok(match.runners[0].wagonDamage > 0);
  }
});

test('Jade casts from the orb carrier, chains through an ally and reduces repeated hits', () => {
  const match = new RaidMatch(['jade', 'hammer', 'rend', 'bastion']);
  const [jade, carrier, rival, other] = match.runners;
  for (const r of match.runners) Object.assign(r, { basic: 300, brake: 0.4, appliedBrake: 0.4 });
  Object.assign(jade, { x: 0, z: -12 });
  Object.assign(carrier, { x: 0, z: 0 });
  Object.assign(rival, { x: 0, z: 5 });
  Object.assign(other, { x: 0, z: -14 });
  assert.ok(match.cast(0, 0, 1));
  assert.equal(carrier.barrier.until, 75);
  assert.equal(carrier.barrier.amount, 43);
  const aim = match.previewSkill(0, 1, null);
  assert.equal(aim.origin, carrier);
  assert.equal(aim.radius, 6);
  assert.ok(match.cast(0, 1));
  match.step();
  assert.equal(rival.lightningSlow, 30);
  assert.equal(other.lightningSlow, 0);
  assert.ok(carrier.hasteTicks && !jade.hasteTicks);
  // Put the orb on Jade. The ally is the only reachable first hop, followed by the rival.
  jade.z = -8;
  carrier.z = -2;
  rival.z = 4;
  other.z = -30;
  jade.cooldowns[0] = 0;
  assert.ok(match.cast(0, 0, 0));
  const allyHp = carrier.hp,
    hp = rival.hp;
  assert.ok(match.cast(0, 2));
  const chain = match.actions.at(-1).lines;
  assert.equal(chain.length, 4);
  assert.deepEqual(chain[0], { from: { x: 0, z: -8 }, to: { x: 0, z: -2 } });
  assert.deepEqual(chain[1].to, { x: 0, z: 4 });
  match.step();
  assert.equal(carrier.hp, allyHp);
  assert.deepEqual(chain[2].to, { x: 0, z: 10 });
  assert.deepEqual(chain[3].to, { x: 0, z: 4 });
  assert.equal(hp - rival.hp, 60);
  // A single enemy and the caster can relay four jumps; the second hit deals half damage.
  carrier.z = -25;
  rival.z = -4;
  jade.z = -8;
  other.z = -30;
  jade.cooldowns[2] = 0;
  rival.hp = HEROES.rend.hp;
  const before = rival.hp;
  assert.ok(match.cast(0, 2));
  match.step();
  assert.equal(before - rival.hp, 60);
});

test('Jade releases five beams and a local burst from the ally carrying the orb', () => {
  const match = new RaidMatch(['jade', 'hammer', 'rend', 'bastion']);
  const [jade, ally, near, between] = match.runners;
  for (const r of match.runners) Object.assign(r, { basic: 90, brake: 0.4, appliedBrake: 0.4 });
  Object.assign(jade, { x: -3, z: -9 });
  Object.assign(ally, { x: 0, z: 0 });
  Object.assign(near, { x: 0, z: 0.1 });
  Object.assign(between, { x: 2.35, z: 3.24 });
  assert.ok(match.cast(0, 0, 1));
  jade.rage = 100;
  assert.ok(match.cast(0, 3));
  const cue = match.actions.at(-1);
  assert.equal(cue.lines.length, 5);
  assert.ok(cue.lines.every((l) => l.from.x === 0 && l.from.z === 0));
  const hp = between.hp;
  match.step();
  assert.equal(near.hp, 0);
  assert.equal(between.hp, hp);
  assert.equal(jade.rage, 0);
});
