import assert from 'node:assert/strict';
import test from 'node:test';
import { raidSkillCooldown } from '../../src/game/raid/heroes/hero-catalog.ts';
import { originalCooldownSeconds } from '../../src/content/raid/skill-cooldowns.ts';
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

test('Ignite follows its target for four one-second ticks and another skill adds one tick', () => {
  for (const extended of [false, true]) {
    const m = arena('flare'),
      target = m.runners[2];
    const initial = target.hp;
    assert.ok(m.cast(0, 2, 2));
    assert.equal(m.runners[0].cooldowns[2], 12 * RAID_HZ);
    if (extended) assert.ok(m.cast(0, 1));
    target.x = 6;
    advance(m, 29);
    const before = initial - (extended ? 30 : 0);
    assert.equal(target.hp, before);
    m.step();
    assert.equal(target.hp, before - 10);
    advance(m, 90);
    assert.equal(target.hp, before - 40);
    assert.equal(m.runners[0].heroView.burns.length, Number(extended));
    advance(m, 30);
    assert.equal(target.hp, before - (extended ? 50 : 40));
    assert.equal(m.runners[0].heroView.burns.length, 0);
  }
});

test('Fireball explodes on collision and Flame Burst protects against control for fifteen ticks', () => {
  const m = arena('flare');
  const [caster, , primary, nearby] = m.runners;
  nearby.x = 1.5;
  nearby.z = primary.z;
  const hp = [primary.hp, nearby.hp];
  assert.ok(m.cast(0, 0, { dx: 0, dz: 1 }));
  advance(m, 8);
  assert.deepEqual(
    [primary.hp, nearby.hp],
    hp.map((value) => value - 30),
  );
  assert.ok(primary.slowed && nearby.slowed);
  assert.ok(m.cast(0, 1));
  assert.ok(m.cast(2, 1, 0));
  m.step();
  assert.equal(caster.silenced, 0);
  advance(m, 15);
  primary.cooldowns[1] = 0;
  assert.ok(m.cast(2, 1, 0));
  m.step();
  assert.equal(caster.silenced, RAID_HZ);
});

test('Piercing Shot deals half the previous damage after each target', () => {
  const m = arena('longshot');
  const [caster, , first, second] = m.runners;
  caster.x = first.x = second.x = 2.8;
  first.z = 3;
  second.z = 7;
  const hp = [first.hp, second.hp];
  caster.rage = 100;
  assert.ok(m.cast(0, 3, { dx: 0, dz: 1 }));
  advance(m, 45);
  assert.deepEqual([hp[0] - first.hp, hp[1] - second.hp], [56, 28]);
});

test('chart grades control starting health, unmodified basic damage and ticks between hits', () => {
  for (const [hero, hp, basic, interval] of [
    ['flare', 105, 10, 26],
    ['kali', 115, 10, 22],
    ['kaiken', 115, 12, 22],
    ['hammer', 140, 12, 24],
    ['swift', 140, 12, 24],
    ['magnus', 155, 14, 26],
    ['silurian', 140, 12, 24],
    ['bird', 96, 10, 22],
  ]) {
    const match = new RaidMatch([hero, 'rend', 'bastion', 'rime']);
    const runner = match.runners[0];
    for (const other of match.runners.slice(1)) other.basic = 1000;
    Object.assign(runner, { x: 0, z: 8 });
    assert.equal(runner.hp, hp, hero);
    match.step();
    assert.equal(match.damage[0], basic, hero);
    assert.equal(runner.basic, interval, hero);
    advance(match, interval - 1);
    assert.equal(match.damage[0], basic, hero);
    match.step();
    assert.equal(match.damage[0], basic * 2, hero);
  }
});

test('Drizz pulls a rival, launches them, lands from his own jump and punches through a shield', () => {
  const m = arena('drizz');
  const [r, , enemy] = m.runners;
  assert.ok(m.cast(0, 0, { dx: 0, dz: 1 }));
  advance(m, 8);
  assert.equal(enemy.silenced, 0);
  assert.ok(Math.hypot(enemy.x - r.x, enemy.z - r.z) <= 1.01);
  assert.ok(m.cast(0, 1));
  m.step();
  assert.ok(enemy.jumping > 0 && enemy.launchDuration > 0);
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
  assert.equal(r.heroView.iceCrystals, 2);
  assert.ok(m.cast(0, 1));
  m.step();
  assert.ok(enemy.hp < hp - 30);
  assert.equal(r.heroView.iceCrystals, 0);
  assert.equal(m.cast(0, 2), false);
  enemy.x = 3; // Leave the first boss lane so Abyss survives to test the shield.
  advance(m, 63);
  assert.equal(r.heroView.iceCrystals, 1);
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
  advance(m, 157);
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
  assert.deepEqual(rival.slows[0], { ticks: 30, percent: 20, delay: 0 });
  assert.equal(other.slowed, 0);
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

test('matched slots use rank-one timing, patched values and the actual borrowed kit', () => {
  for (const [hero, expected] of [
    ['hammer', [8, 16, 14]],
    ['orc', [8, 16, 14]],
    ['longshot', [13, 14, 16]],
    ['alice', [11, 11, 12]],
    ['kali', [4, 11, 13]],
    ['rildin', [7, 15, 7]],
    ['kaiken', [6, 7, 16]],
    ['magnus', [17, 17, 17]],
    ['drizz', [15, 8, 8]],
    ['abyss', [5, 9, 12]],
    ['hof', [15, 3.5, 7]],
    ['vallet', [5, 21, 7]],
    ['freesia', [5, 3.5, 7]],
  ])
    assert.deepEqual(
      [0, 1, 2].map((i) => raidSkillCooldown(hero, i) / RAID_HZ),
      expected,
      hero,
    );
  assert.equal(originalCooldownSeconds('alice', 0, 4), 8);
  assert.equal(originalCooldownSeconds('froze', 0), undefined);
  const m = arena('hammer');
  assert.ok(m.cast(0, 0));
  assert.equal(m.runners[0].cooldowns[0], 240);
  advance(m, 239);
  assert.equal(m.cast(0, 0), false);
  m.step();
  assert.ok(m.cast(0, 0));
});

test('Magnus spends and recovers each mode cooldown independently', () => {
  const m = arena('magnus');
  const r = m.runners[0];
  assert.ok(m.cast(0, 1));
  assert.ok(m.cast(0, 3));
  assert.equal(r.cooldowns[1], 0);
  advance(m, 30);
  assert.ok(m.cast(0, 1));
  advance(m, 134);
  assert.equal(m.cast(0, 3), false);
  m.step();
  assert.ok(m.cast(0, 3));
  assert.equal(r.cooldowns[1], 17 * RAID_HZ - 165);
  advance(m, 165);
  assert.ok(m.cast(0, 3));
  assert.equal(r.cooldowns[1], 17 * RAID_HZ - 300);
});
