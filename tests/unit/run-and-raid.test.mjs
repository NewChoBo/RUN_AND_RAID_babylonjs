import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RaidMatch,
  HEROES,
  HERO_IDS,
  RAID_HZ,
  raidAimKind,
  raidBasicReach,
  RAID_LEAP_TICKS,
  raidRunnerHeight,
  raidRunnerPositionAfter,
  raidRoadTravel,
  raidRespawnTicks,
  ROUND_TICKS,
  WAGON,
  WAGON_HP,
} from '../../src/game/raid/raid-match.ts';
import { createRaidFeature } from '../../src/game/raid/raid-feature.ts';
import { raidRageDamageToFull, raidRageGain } from '../../src/content/raid/rage.ts';
import { driveRaidBots } from '../../src/game/raid/raid-bots.ts';
import { RAID_FRONT_Z } from '../../src/game/raid/runner-motion.ts';
import { GameSession } from '../../src/game/session/game-session.ts';

function advance(match, ticks) {
  for (let i = 0; i < ticks; i++) match.step();
}
function battle(hero, playerAspect) {
  const match = new RaidMatch(hero, playerAspect);
  const session = new GameSession([createRaidFeature(match)]);
  for (const r of match.runners) session.addPlayer(String(r.slot), { slot: r.slot });
  const send = (slot, action, payload) =>
    session.dispatch(String(slot), { kind: 'raid.' + action, payload }).ok;
  return { match, send };
}

test('Rildin weaves four frontal slashes with basics and reopens the chain with Unbound Sword', () => {
  const { match, send } = battle('rildin');
  const [r] = match.runners;
  r.x = 0;
  r.z = 8;
  match.step();
  for (let i = 0; i < 4; i++) {
    assert.ok(send(0, 'cast', { skill: 0 }));
    advance(match, 8);
  }
  assert.deepEqual(
    match.actions.filter((a) => a.slot === 0).map((a) => a.skill),
    ['basic', 0, 'basic', 0, 'basic', 0, 'basic', 0],
  );
  assert.deepEqual(
    match.actions.filter((a) => a.slot === 0 && a.skill === 0).map((a) => a.comboStep),
    [1, 2, 3, 4],
  );
  assert.equal(send(0, 'cast', { skill: 0 }), false);
  r.rage = 100;
  assert.ok(send(0, 'cast', { skill: 3 }));
  assert.equal(r.rage, 0);
  assert.equal(raidBasicReach(r, match.tick), HEROES.rildin.reach + 1.5);
  assert.ok(send(0, 'cast', { skill: 0 }));
  assert.ok(send(0, 'cast', { skill: 2, dx: 1, dz: 0 }));
  advance(match, 6);
  const x = r.x;
  assert.ok(send(0, 'cast', { skill: 2, dx: -1, dz: 0 }));
  advance(match, 6);
  assert.ok(r.x < x - 2.9);
});

test('Counter negates one incoming hit and stuns enemies around Rildin', () => {
  const { match, send } = battle(['rildin', 'hammer', 'alice', 'rime']);
  const [r, , enemy] = match.runners;
  for (const runner of match.runners) runner.basic = 99;
  const before = r.hp;
  assert.ok(send(0, 'cast', { skill: 1 }));
  assert.ok(send(2, 'cast', { skill: 1, target: 0 }));
  assert.ok(send(3, 'cast', { skill: 1, target: 0 }));
  match.step();
  assert.equal(r.hp, before - 3 * HEROES.rime.power);
  assert.equal(r.silenced, 0);
  assert.equal(enemy.stunned, RAID_HZ);
});

test('Chain Slash previews the same frontal, ground-level targets that it hits', () => {
  for (const [z, jumping, empowered, hits] of [
    [4.5, 0, false, 1],
    [-2, 0, false, 0],
    [3, 12, false, 0],
    [6.5, 0, false, 0],
    [6.5, 0, true, 1],
  ]) {
    const { match, send } = battle(['rildin', 'jade', 'rime', 'hammer']);
    const [caster, , rival, far] = match.runners;
    Object.assign(caster, { x: 0, z: 0, rage: 100 });
    Object.assign(rival, { x: 0, z, jumping });
    far.z = -5;
    if (empowered) assert.ok(send(0, 'cast', { skill: 3 }));
    const before = rival.hp;
    for (let i = 0; i < 2; i++) assert.equal(match.previewSkill(0, 0, null).count, hits);
    assert.equal(caster.heroView.slashes, 0);
    assert.ok(send(0, 'cast', { skill: 0 }));
    // Chain Slash also readies a basic attack. Measure the skill's damage in isolation.
    for (const r of match.runners) r.basic = 100;
    match.step();
    assert.equal(before - rival.hp, hits * HEROES.rildin.power);
  }
});

test('two matches and a new life each own a separate Chain Slash combo', () => {
  const a = battle(['rildin', 'jade', 'rime', 'hammer']);
  const b = battle('rildin');
  const caster = a.match.runners[0];
  assert.ok(a.send(0, 'cast', { skill: 0 }));
  assert.equal(caster.heroView.slashes, 1);
  assert.equal(b.match.runners[0].heroView.slashes, 0);
  caster.hp = 1;
  assert.ok(a.send(2, 'cast', { skill: 1, target: 0 }));
  a.match.step();
  assert.ok(caster.respawn);
  assert.equal(caster.heroView.slashes, 0);
});

test('Rising Moon hits a nearby rival three times with reduced damage on the overlapping blades', () => {
  const { match } = battle('kaiken');
  const [r, , enemy, other] = match.runners;
  for (const runner of match.runners) runner.basic = 1000;
  Object.assign(r, { x: 0, z: 0 });
  Object.assign(enemy, { x: 0, z: 1 });
  other.x = 8;
  const hp = enemy.hp;
  assert.ok(match.cast(0, 1, { dx: 0, dz: 1 }));
  advance(match, 4);
  const full = HEROES.kaiken.power * 2;
  assert.ok(Math.abs(hp - enemy.hp - full * (1 + 2 * 0.4)) < 1e-6);
});

test('jumping clears the low Crescent but not an upright Rising Moon blade; the fan leaves gaps', () => {
  function shot(skill, jump, x) {
    const { match, send } = battle('kaiken');
    const [r, , victim] = match.runners;
    for (const runner of match.runners) {
      runner.basic = 300;
      runner.brake = 0.4;
    }
    r.x = r.z = 0;
    victim.x = x;
    victim.z = 6;
    const start = victim.hp;
    if (jump) assert.ok(send(2, 'jump'));
    assert.ok(send(0, 'cast', { skill, dx: 0, dz: 1 }));
    advance(match, 16);
    return start - victim.hp;
  }
  assert.ok(shot(0, false, 0) > 0);
  assert.equal(shot(0, true, 0), 0);
  assert.ok(shot(1, true, 0) > 0);
  assert.equal(shot(1, false, 1.05), 0);
  assert.ok(shot(1, false, 2.13) > 0);
});

test('Kaiken can cut Full Moon short and spin on the road tile at the interruption', () => {
  const { match, send } = battle('kaiken');
  const [r, , victim] = match.runners;
  for (const runner of match.runners) {
    runner.basic = 300;
    runner.brake = 0.4;
  }
  victim.x = r.x + 2;
  victim.z = r.z;
  assert.equal(raidAimKind('kaiken', 2), 'pulse');
  assert.equal(send(0, 'cast', { skill: 2, dx: 1, dz: 0 }), false);
  assert.ok(send(0, 'cast', { skill: 2 }));
  assert.deepEqual(r.dash.to, { x: r.x, z: r.z + 5.5 });
  advance(match, 4);
  const stop = { x: r.x, z: r.z };
  const cooldown = r.cooldowns[2];
  assert.ok(send(0, 'cast', { skill: 2 }));
  assert.equal(r.cooldowns[2], cooldown);
  assert.equal(send(0, 'cast', { skill: 2 }), false);
  assert.deepEqual(match.actions.at(-1).to, stop);
  assert.ok(send(0, 'move', { side: 1, brake: 0 }));
  match.step();
  assert.equal(r.x, stop.x);
  assert.ok(Math.abs(r.z + raidRoadTravel(1) - stop.z) < 1e-8);
  assert.ok(victim.hp < HEROES[victim.hero].hp);
  assert.equal(victim.staggered, 0);
  r.rage = 100;
  assert.ok(send(0, 'cast', { skill: 3 }));
});

test('Kaiken channels five ultimate pulses with other attacks locked and no rage refund', () => {
  const { match, send } = battle('kaiken');
  const [r] = match.runners;
  for (const runner of match.runners) runner.basic = 300;
  assert.ok(send(0, 'move', { side: 0, brake: 0.4 }));
  r.x = 0;
  r.z = 8;
  r.rage = 100;
  r.basic = 0;
  const score = match.damage[0];
  assert.ok(send(0, 'cast', { skill: 3 }));
  assert.equal(send(0, 'cast', { skill: 0, dx: 0, dz: 1 }), false);
  advance(match, 75);
  assert.equal(match.damage[0] - score, 10 * HEROES.kaiken.power);
  assert.equal(r.rage, 0);
});

test('Full Moon follows the facing of a sideways slash and sweeps once on natural arrival', () => {
  const { match, send } = battle('kaiken');
  const [r] = match.runners;
  assert.ok(send(0, 'cast', { skill: 0, dx: -1, dz: 0 }));
  const endpoint = { x: r.x - 5.5, z: r.z };
  assert.ok(send(0, 'cast', { skill: 2 }));
  assert.equal(r.dash.to.x, endpoint.x);
  assert.ok(Math.abs(r.dash.to.z - endpoint.z) < 1e-8);
  advance(match, 18);
  assert.equal(r.dash, null);
  assert.equal(send(0, 'cast', { skill: 2 }), false);
  const cues = match.actions.filter((cue) => cue.slot === 0 && cue.skill === 2);
  assert.deepEqual(
    cues.map((cue) => cue.phase),
    ['dash', 'spin'],
  );
  assert.deepEqual(cues[1].to, { x: r.x, z: r.z });
  assert.ok(send(0, 'move', { side: 1, brake: 0 }));
  advance(match, 16);
  assert.equal(r.x, cues[1].to.x);
  assert.ok(Math.abs(r.z + raidRoadTravel(16) - cues[1].to.z) < 1e-8);
  const endOfSpin = { x: r.x, z: r.z };
  match.step();
  assert.ok(r.x > endOfSpin.x && r.z > endOfSpin.z);
});

for (const [hero, reach, ticks] of [
  ['kaiken', 5.5, 18],
  ['rildin', 3, 6],
  ['swift', 3, 6],
  ['hammer', 10, RAID_LEAP_TICKS],
]) {
  test(`${hero} travels the skill distance on the road in every direction regardless of steering or brake`, () => {
    for (const [dx, dz] of [
      [0, -1],
      [0, 1],
      [1, 0],
      [-0.6, -0.8],
    ]) {
      for (const brake of [0, 0.5, 1]) {
        const { match, send } = battle(hero);
        const [r] = match.runners;
        for (const runner of match.runners) runner.basic = 90;
        // Allow ten metres of uninterrupted road in both directions.
        r.z = -3;
        const origin = { x: r.x, z: r.z };
        assert.ok(send(0, 'move', { side: 1, brake }));
        switch (hero) {
          case 'kaiken':
            assert.ok(send(0, 'cast', { skill: 0, dx, dz }));
            assert.ok(send(0, 'cast', { skill: 2 }));
            break;
          case 'rildin':
            assert.ok(send(0, 'cast', { skill: 2, dx, dz }));
            break;
          case 'swift': {
            const target = match.runners[2];
            target.x = origin.x + dx * (reach + 0.85);
            target.z = origin.z + dz * (reach + 0.85);
            assert.ok(send(0, 'cast', { skill: 1, target: target.slot }));
            break;
          }
          case 'hammer':
            assert.ok(
              send(0, 'cast', { skill: 1, x: origin.x + dx * reach, z: origin.z + dz * reach }),
            );
            break;
        }
        for (let age = 0; age < ticks; age++) {
          const predicted = raidRunnerPositionAfter(r, 0.5);
          match.step();
          for (const [point, elapsed] of [
            [predicted, age + 0.5],
            [r, age + 1],
          ]) {
            assert.ok(Math.abs(point.x - origin.x - (dx * reach * elapsed) / ticks) < 1e-8);
            assert.ok(
              Math.abs(
                point.z - origin.z + raidRoadTravel(elapsed) - (dz * reach * elapsed) / ticks,
              ) < 1e-8,
            );
          }
        }
        assert.equal(r.dash, null);
        assert.equal(r.leap, null);
      }
    }
  });
}

test('forward dashes and blinks respect the running limit even when the locked boss is farther ahead', () => {
  assert.equal(RAID_FRONT_Z, WAGON.z - 1.6);
  for (const [hero, skill, input] of [
    ['rildin', 2, { dx: 0.3, dz: 1 }],
    ['kali', 3, { dx: 0.3, dz: 1 }],
    ['kaiken', 2, undefined],
    ['swift', 1, 'wagon'],
    ['swift', 3, 'wagon'],
    ['kali', 2, 'wagon'],
  ]) {
    const { match } = battle(hero);
    const r = match.runners[0];
    Object.assign(r, { x: WAGON.x, z: RAID_FRONT_Z - 0.3, rage: 100 });
    for (const runner of match.runners) runner.basic = 90;
    // Swift's lunge stops short of its target and can finish naturally behind the limit.
    const aim =
      typeof input === 'object'
        ? match.previewSkill(0, skill, { x: r.x + input.dx, z: r.z + input.dz })
        : null;
    assert.ok(match.cast(0, skill, input), hero);
    while (r.dash) {
      assert.ok(raidRunnerPositionAfter(r, 0.5).z <= RAID_FRONT_Z + 1e-8, hero);
      match.step();
      assert.ok(r.z <= RAID_FRONT_Z + 1e-8, hero);
    }
    assert.ok(r.z <= RAID_FRONT_Z && r.z >= RAID_FRONT_Z - 0.5, hero);
    if (aim) {
      assert.ok(Math.hypot(r.x - aim.dash.end.x, r.z - aim.dash.end.z) < 1e-8);
      assert.ok(r.x > WAGON.x);
    }
    if (input === 'wagon') {
      match.step();
      assert.ok(match.damage[0] > 0, hero);
    }
  }
});

test('a leap aimed over the wagon lands on the last legal road tile and applies only overlapping splash', () => {
  for (const [x, hitsBoss] of [
    [0, true],
    [3, false],
  ]) {
    const { match, send } = battle('hammer');
    const r = match.runners[0];
    Object.assign(r, { x, z: RAID_FRONT_Z - 1 });
    for (const runner of match.runners) runner.basic = 90;
    const request = { x, z: WAGON.z + 2 };
    const preview = match.previewSkill(0, 1, request);
    assert.deepEqual(preview.point, { x, z: RAID_FRONT_Z });
    assert.equal(preview.status, 'ready');
    assert.ok(send(0, 'cast', { skill: 1, ...request }));
    assert.deepEqual(r.leap.to, preview.point);
    for (let i = 0; i < RAID_LEAP_TICKS; i++) {
      assert.ok(raidRunnerPositionAfter(r, 0.5).z <= RAID_FRONT_Z);
      match.step();
      assert.ok(r.z <= RAID_FRONT_Z);
    }
    assert.equal(r.z, RAID_FRONT_Z - raidRoadTravel(RAID_LEAP_TICKS));
    assert.equal(match.damage[0], hitsBoss ? HEROES.hammer.power * 2 : 0);
  }
});

test('Swift designates a quarry, closes over time and blinks behind a visible target inside eight metres', () => {
  const { match, send } = battle('swift');
  const [r, , victim] = match.runners;
  for (const runner of match.runners) {
    runner.basic = 90;
    runner.brake = 0.4;
  }
  r.x = victim.x = 0;
  r.z = 0;
  victim.z = 7;
  assert.ok(send(0, 'cast', { skill: 2, target: 2 }));
  assert.ok(r.heroView.trackingDagger);
  for (let tick = 0; tick < RAID_HZ && r.heroView.trackingDagger; tick++) match.step();
  assert.equal(r.heroView.quarry, 2);
  const aimZ = victim.z;
  const hpBeforeLunge = victim.hp;
  assert.ok(send(0, 'cast', { skill: 1, target: 2 }));
  advance(match, 3);
  assert.ok(r.z > 1 && r.z < 5);
  advance(match, 3);
  assert.ok(Math.abs(r.z + raidRoadTravel(6) - (aimZ - 0.85)) < 1e-8);
  assert.ok(
    victim.z - r.z <= HEROES.swift.reach && victim.hp === hpBeforeLunge - 3 * HEROES.swift.power,
  );
  r.basic = 0;
  match.step();
  assert.ok(r.basic < HEROES.swift.cooldown);
  const basic = match.actions.findLast((cue) => cue.slot === r.slot && cue.skill === 'basic');
  assert.equal(basic.basicSpeed, HEROES.swift.cooldown / r.basic);
  r.rage = 100;
  victim.z = r.z + 9;
  assert.equal(send(0, 'cast', { skill: 3, target: 2 }), false);
  assert.equal(r.rage, 100);
  victim.z = r.z + 4;
  const before = victim.hp;
  assert.ok(send(0, 'cast', { skill: 3, target: 2 }));
  assert.equal(r.z, victim.z - 1.1);
  match.step();
  assert.equal(victim.hp, before - HEROES.swift.power * 7);
  assert.ok(victim.slowed);
  assert.equal(r.rage, 0);
});

test('a designated hit repeats independently of the basic lock and cannot transfer to a new life', () => {
  const { match, send } = battle(['rend', 'abyss', 'longshot', 'jade']);
  const [caster, , rival] = match.runners;
  assert.equal(send(0, 'cast', { skill: 1, repeat: true }), false);
  assert.equal(send(0, 'cast', { skill: 1, target: rival.slot }), true);
  assert.equal(caster.lastStrike, null);
  advance(match, 1);
  assert.equal(caster.lastStrike, rival.slot);
  assert.equal(send(0, 'lock', 'wagon'), true);
  caster.cooldowns[1] = 0;
  assert.equal(send(0, 'cast', { skill: 1, repeat: true, target: 'wagon' }), false);
  rival.z = -40;
  assert.equal(send(0, 'cast', { skill: 1, repeat: true }), false);
  assert.equal(caster.cooldowns[1], 0);
  rival.z = 2;
  rival.hp = 1;
  assert.equal(send(0, 'cast', { skill: 1, repeat: true }), true);
  advance(match, 1);
  assert.ok(rival.respawn);
  assert.equal(caster.lastStrike, null);
  assert.equal(caster.target, 'wagon');
});

test('an ally ward remembers its own recipient and a chain cannot consume the remembered cast', () => {
  const { match, send } = battle('jade');
  const caster = match.runners[0];
  assert.equal(send(0, 'cast', { skill: 0, ally: 1 }), true);
  assert.equal(caster.lastWard, 1);
  assert.equal(caster.lastStrike, null);
  caster.cooldowns[0] = 0;
  assert.equal(send(0, 'cast', { skill: 2, repeat: true }), false);
  assert.equal(caster.cooldowns[2], 0);
  assert.equal(send(0, 'cast', { skill: 0, repeat: true }), true);
});
test('aim feedback distinguishes an empty cast, a hit and an unreachable point before spending a skill', () => {
  const { match, send } = battle(['rend', 'abyss', 'longshot', 'jade']);
  const runner = match.runners[0];
  const rival = match.runners[2];
  assert.equal(match.previewSkill(0, 1, rival).status, 'needTarget');
  const field = match.previewSkill(0, 2, { x: -5.7, z: 9 });
  assert.equal(field.status, 'ready');
  assert.equal(field.count, 0);
  for (const point of [{ x: 8, z: 8 }, { x: runner.x, z: -15 }, { x: 0, z: WAGON.z + 4 }, WAGON]) {
    const fresh = battle(['rend', 'abyss', 'longshot', 'jade']);
    assert.equal(fresh.match.previewSkill(0, 2, point).status, 'ready');
    assert.ok(fresh.send(0, 'cast', { skill: 2, ...point }));
  }
  assert.equal(match.previewSkill(0, 2, { x: runner.x, z: -15.01 }).status, 'outOfRange');
  const area = match.previewSkill(0, 2, rival);
  assert.equal(area.status, 'ready');
  assert.equal(area.count, 2);
  const hp = match.runners.map((r) => r.hp);
  assert.ok(send(0, 'cast', { skill: 2, x: rival.x, z: rival.z }));
  match.step();
  assert.equal(
    match.runners.filter((r, i) => hp[i] - r.hp === 3 * HEROES.rend.power).length,
    area.count,
  );
  assert.equal(match.previewSkill(0, 2, rival).status, 'unavailable');
  assert.ok(send(0, 'move', { side: 0, brake: 1 }));
  advance(match, 65);
  assert.ok(match.canTarget(0, 'wagon'));
  const shot = match.previewSkill(0, 1, null, 'wagon');
  assert.equal(shot.range, 16);
  assert.equal(shot.status, 'outOfRange');
  assert.equal(send(0, 'cast', { skill: 1, target: 'wagon' }), false);
  assert.equal(runner.cooldowns[1], 0);
  assert.ok(send(0, 'move', { side: 0, brake: 0 }));
  // Run until the actual muzzle-to-wagon distance is back inside the 16 m targeting range.
  while (Math.hypot(runner.x - WAGON.x, runner.z - WAGON.z) > shot.range && match.tick < 150)
    match.step();
  assert.equal(match.previewSkill(0, 1, null, 'wagon').status, 'ready');
  assert.ok(send(0, 'cast', { skill: 1, target: 'wagon' }));
});

test('self pulses and ally wards preview the recipient and range used by the cast', () => {
  const { match } = battle('jade');
  const grove = battle('freesia').match.previewSkill(0, 0, match.runners[0]);
  assert.deepEqual([grove.status, grove.count, grove.allies], ['ready', 2, 2]);
  const ward = match.previewSkill(0, 0, null, 1);
  assert.deepEqual([ward.kind, ward.range, ward.status], ['ward', 15, 'ready']);
  assert.equal(match.previewSkill(0, 0, null, 2).status, 'needTarget');
  assert.equal(match.cast(0, 0), false);
  assert.equal(match.runners[0].cooldowns[0], 0);
  assert.ok(match.cast(0, 0, 1));
  assert.ok(match.runners[1].barrier);
  const hammer = match.runners.find((r) => r.hero === 'hammer');
  const pulse = match.previewSkill(hammer.slot, 0, WAGON);
  assert.deepEqual(
    [pulse.kind, pulse.origin, pulse.point, pulse.radius],
    ['pulse', hammer, hammer, HEROES.hammer.radius],
  );
  assert.ok(match.cast(hammer.slot, 0));
  assert.deepEqual(match.actions.at(-1).to, { x: hammer.x, z: hammer.z });
});
test('each team fields two runners and all four heroes are distinct', () => {
  for (const hero of HERO_IDS) {
    const { runners } = new RaidMatch(hero);
    assert.equal(runners[0].hero, hero);
    assert.equal(new Set(runners.map((r) => r.hero)).size, 4);
    assert.deepEqual(
      runners.map((r) => r.team),
      [0, 0, 1, 1],
    );
  }
});
test('each accepted cast records one cue, including an empty field or a full-health ally shield', () => {
  const { match, send } = battle('freesia');
  assert.ok(send(0, 'cast', { skill: 1, target: 1 }));
  assert.ok(send(0, 'cast', { skill: 0, x: -5, z: 4 }));
  assert.equal(send(0, 'cast', { skill: 0, x: -5, z: 4 }), false);
  assert.deepEqual(
    match.actions.map(({ id, hero, skill, to }) => [id, hero, skill, to]),
    [
      [1, 'freesia', 1, { x: -3.3, z: -2 }],
      [2, 'freesia', 0, { x: -5, z: 4 }],
    ],
  );
  advance(match, 100);
  assert.ok(match.actions.every((cue) => cue.id > 2));
});
test('the moving wagon takes arrow rain on impact and two pulses before leaving its six-metre radius', () => {
  const { match, send } = battle('longshot');
  // Suppress basics so the field alone determines wagon damage.
  for (const r of match.runners) r.basic = 120;
  assert.ok(send(0, 'move', { side: 0, brake: 1 }));
  advance(match, 12);
  const before = match.damage[0];
  assert.ok(send(0, 'cast', { skill: 1, ...WAGON }));
  advance(match, 14);
  assert.equal(match.damage[0] - before, 12);
  match.step();
  assert.equal(match.damage[0] - before, 24);
  advance(match, 15);
  assert.equal(match.damage[0] - before, 36);
  advance(match, 15);
  assert.equal(match.damage[0] - before, 36);
});
test('running into arrow rain or a dark vortex triggers a later pulse at the placed road point', () => {
  for (const hero of ['longshot', 'abyss']) {
    const { match, send } = battle(hero);
    const rival = match.runners[2];
    for (const r of match.runners) r.basic = 90;
    rival.z = -2;
    const hp = rival.hp;
    assert.ok(send(0, 'cast', { skill: 1, x: rival.x, z: 10 }));
    // The caster brakes and changes lanes after release. The rival keeps running straight.
    assert.ok(send(0, 'move', { side: -1, walk: true }));
    advance(match, 29);
    assert.equal(rival.hp, hp);
    assert.equal(rival.slowed, 0);
    match.step();
    if (hero === 'longshot') assert.equal(rival.hp, hp - 3 * HEROES.longshot.power);
    assert.deepEqual(
      rival.slows[0],
      hero === 'longshot'
        ? { percent: 18, ticks: 30, delay: 0 }
        : { percent: 20, ticks: 60, delay: 0 },
    );
  }
});
test('each charged ultimate applies its hero effect to the selected formation', () => {
  // The blade heroes have separate combo, channel and teleport scenarios below.
  for (const hero of ['hammer', 'longshot', 'rend', 'bastion', 'rime']) {
    const { match, send } = battle(hero);
    const [caster, , flank, rear] = match.runners;
    for (const r of match.runners) Object.assign(r, { basic: 90, brake: 0.4, appliedBrake: 0.4 });
    caster.rage = 100;
    caster.hp -= 40;
    flank.x = rear.x + 1.5;
    flank.z = rear.z;
    if (hero === 'longshot') rear.shield = 75;
    const beforeCaster = caster.hp;
    const beforeRear = rear.hp,
      beforeFlank = flank.hp;
    assert.ok(
      send(
        0,
        'cast',
        hero === 'longshot'
          ? { skill: 3, dx: rear.x - caster.x, dz: rear.z - caster.z }
          : { skill: 3, target: 3 },
      ),
    );
    advance(match, hero === 'longshot' ? RAID_HZ + 10 : 1);
    assert.equal(caster.rage, 0);
    assert.equal(rear.hp, beforeRear - 7 * HEROES[hero].power);
    if (hero === 'hammer') {
      assert.equal(flank.hp, beforeFlank - (beforeRear - rear.hp) / 2);
      assert.equal(rear.stunned, 45);
      assert.equal(flank.stunned, 0);
    }
    if (hero === 'rime') assert.equal(rear.slowed, 3 * RAID_HZ);
    if (hero === 'bastion') assert.equal(caster.shield, 3 * RAID_HZ);
    if (hero === 'rend')
      assert.equal(
        caster.hp,
        Math.min(HEROES.rend.hp, beforeCaster + Math.ceil((7 * HEROES.rend.power) / 3)),
      );
    if (hero === 'longshot') assert.ok(rear.shield);
  }
});

test('Piercing Shot draws for one second, then launches once from the moving archer', () => {
  const { match } = battle('longshot');
  const caster = match.runners[0];
  for (const r of match.runners) r.basic = 90;
  caster.rage = 100;
  assert.ok(match.cast(0, 3, { dx: 1, dz: 0 }));
  const cue = match.actions.at(-1);
  assert.equal(cue.skill, 3);
  assert.equal(match.projectiles.length, 0);
  advance(match, RAID_HZ - 1);
  assert.equal(match.projectiles.length, 0);
  match.step();
  const [shot] = match.projectiles;
  assert.equal(match.projectiles.length, 1);
  assert.equal(shot.x, caster.x);
  assert.equal(shot.z, caster.z);
  assert.equal(shot.dx, 1);
  assert.equal(match.actions.filter((a) => a.slot === 0 && a.skill === 3).length, 1);
  assert.notEqual(shot.z, cue.from.z);
  match.step();
  assert.ok(shot.x > caster.x);
});

test('an interrupted Piercing Shot ends its pose without firing later', () => {
  for (const interrupt of ['cast', 'stagger', 'death']) {
    const { match } = battle('longshot');
    const caster = match.runners[0];
    caster.rage = 100;
    assert.ok(match.cast(0, 3, { dx: 1, dz: 0 }));
    const cue = match.actions.at(-1);
    advance(match, 4);
    if (interrupt === 'cast') assert.ok(match.cast(0, 2, { dx: -1, dz: 0 }));
    if (interrupt === 'stagger') caster.staggered = 1;
    if (interrupt === 'death') caster.respawn = 120;
    match.step();
    assert.ok(cue.cancelledAt <= match.tick);
    advance(match, RAID_HZ);
    assert.equal(
      match.projectiles.some((shot) => shot.caster === 0 && shot.skill === 3),
      false,
    );
  }
});
test('Longshot lands separate arrows up close, slows with W and can still be hit during E', () => {
  const { match } = battle(['longshot', 'hammer', 'rend', 'jade']);
  for (const r of match.runners) r.basic = 100;
  const [caster, , rival] = match.runners;
  rival.x = caster.x;
  rival.z = caster.z + 0.1;
  const hp = rival.hp;
  assert.ok(match.cast(0, 0, { dx: 0, dz: 1 }));
  match.step();
  assert.equal(hp - rival.hp, 20 + 6 * 4);
  assert.ok(match.cast(0, 1, { x: rival.x, z: rival.z }));
  match.step();
  assert.ok(rival.slowed > 0);
  assert.ok(match.cast(0, 2, { dx: -1, dz: 0 }));
  assert.ok(match.cast(2, 1, 0));
  const before = caster.hp;
  match.step();
  assert.ok(caster.hp < before);
});
test('a wounded ally heals inside the grove and receives no further healing after running past it', () => {
  const { match, send } = battle(['freesia', 'hammer', 'bastion', 'jade']);
  for (const runner of match.runners) runner.basic = 120;
  const ally = match.runners[1];
  assert.ok(send(0, 'move', { side: 0, brake: 1 }));
  assert.ok(send(2, 'cast', { skill: 1, target: 1 }));
  match.step();
  for (const rival of match.runners.slice(2)) rival.z = -35;
  const before = ally.hp;
  assert.ok(send(0, 'cast', { skill: 0, x: ally.x, z: ally.z + 5 }));
  advance(match, RAID_HZ);
  assert.equal(ally.hp - before, 10);
  assert.equal(match.runners[0].rage, 0);
  advance(match, RAID_HZ);
  assert.equal(ally.hp - before, 10);
});
test('only connected runners can lock an opponent and spend a ready, in-range skill', () => {
  const { match, send } = battle('rend');
  for (const r of match.runners) r.basic = 10;
  assert.equal(send(9, 'jump'), false);
  assert.equal(send(0, 'lock', 1), false);
  assert.equal(send(0, 'cast', { skill: 2, x: Infinity, z: 0 }), false);
  assert.equal(send(0, 'cast', { skill: 2, x: 0, z: -30 }), false);
  assert.equal(send(0, 'cast', { skill: 3, target: 'wagon' }), false);
  assert.equal(send(0, 'cast', { skill: 2, ...WAGON, slot: 2 }), true);
  assert.equal(send(0, 'cast', { skill: 2, ...WAGON }), false);
  match.step();
  assert.ok(match.damage[0] > 0);
  assert.equal(match.damage[1], 0);
});
test('Bolt requires its own target and never changes the basic attack target', () => {
  const { match, send } = battle(['rend', 'abyss', 'longshot', 'jade']);
  const runner = match.runners[0];
  assert.equal(send(0, 'cast', { skill: 1 }), false);
  for (const target of [1, 9, 2.5]) {
    assert.equal(send(0, 'cast', { skill: 1, target }), false);
    assert.equal(runner.target, 'wagon');
    assert.equal(runner.cooldowns[1], 0);
  }
  assert.ok(send(0, 'cast', { skill: 1, target: 2 }));
  const cooldown = runner.cooldowns[1];
  assert.ok(cooldown > 0);
  assert.equal(send(0, 'cast', { skill: 1, target: 3 }), false);
  assert.equal(runner.target, 'wagon');
  assert.equal(runner.cooldowns[1], cooldown);
  match.step();
  assert.equal(match.runners[2].hp, HEROES.longshot.hp - 33);
  assert.equal(match.runners[3].hp, HEROES.jade.hp);
  assert.equal(match.damage[0], 0);
});
test('a runner can hold a 56 m rear gap, then close with the wagon and attack it automatically', () => {
  const { match, send } = battle();
  send(0, 'move', { side: -1, walk: true });
  advance(match, 600);
  assert.equal(WAGON.z - match.runners[0].z, 56);
  assert.ok(match.runners[0].x < -1.6);
  send(0, 'move', { side: 1, walk: false });
  advance(match, 30);
  send(0, 'move', { side: 0, walk: false });
  advance(match, 750);
  assert.ok(match.runners[0].z > 7);
  assert.ok(match.damage[0] > 0);
});
test('leaps and backward dashes stop at the rear edge as the wagon moves', () => {
  const rear = WAGON.z - 56;
  for (const hero of ['hammer', 'rildin']) {
    const { match } = battle(hero);
    const r = match.runners[0];
    r.z = rear;
    if (hero === 'hammer') {
      // A lateral rim pick needs room for the wagon travel during the leap.
      const requested = { x: r.x + 10, z: rear };
      const preview = match.previewSkill(0, 1, requested);
      assert.equal(preview.status, 'ready');
      assert.ok(match.cast(0, 1, preview.point));
    } else {
      r.z += 1;
      assert.ok(match.cast(0, 2, { dx: 0, dz: -1 }));
    }
    const ticks = r.dash?.ticks ?? RAID_LEAP_TICKS;
    for (let i = 0; i < ticks; i++) {
      match.step();
      assert.ok(r.z >= rear - 1e-8);
    }
    assert.ok(Math.abs(r.z - rear) < 1e-8);
  }
});
test('each runner opens fire as the wagon crosses the radius of their basic attack', () => {
  for (const [hero, metres] of Object.entries({
    hammer: HEROES.hammer.reach,
    abyss: HEROES.abyss.reach,
    jade: HEROES.jade.reach,
    longshot: HEROES.longshot.reach,
  })) {
    const { match, send } = battle(hero);
    const player = match.runners[0];
    for (const r of match.runners) assert.ok(send(r.slot, 'move', { side: 0, brake: 1 }));
    advance(match, 75);
    const distance = () => Math.hypot(WAGON.x - player.x, WAGON.z - player.z);
    assert.ok(distance() > metres && player.basic === 0);
    assert.ok(send(0, 'move', { side: 0, brake: 0 }));
    const before = match.damage[0];
    for (let ticks = 0; ticks < 8 * RAID_HZ && !player.basic; ticks++) {
      assert.ok(distance() > metres, hero);
      match.step();
    }
    assert.ok(player.basic > 0 && distance() <= metres, hero);
    assert.equal(match.damage[0] - before, HEROES[hero].basicAttack, hero);
  }
});
test('held steering reaches both widened lateral limits and releases inward immediately', () => {
  const { match, send } = battle();
  const runner = match.runners[0];
  for (const side of [-1, 1]) {
    assert.ok(send(0, 'move', { side, brake: 0.4 }));
    advance(match, 3 * RAID_HZ);
    assert.equal(runner.x, side * 6.6);
    assert.equal(raidRunnerPositionAfter(runner, 0.5).x, runner.x);
    assert.ok(send(0, 'move', { side: -side, brake: 0.4 }));
    match.step();
    assert.ok(Math.abs(runner.x) < 6.6);
  }
});

test('stick travel scales lateral and forward distance, and release restores full running speed', () => {
  const { match, send } = battle();
  const runner = match.runners[0];
  for (const [side, brake, lateral, forward] of [
    [-0.25, 0.25, -1.2, 7.05],
    [0.5, 0.5, 2.4, 5.3],
    [0, 1, 0, 1.8],
    [0, 0, 0, 8.8],
  ]) {
    assert.ok(send(0, 'move', { side, brake }));
    advance(match, 12);
    const { x, z } = runner;
    advance(match, RAID_HZ);
    assert.ok(Math.abs(runner.x - x - lateral) < 0.001);
    assert.ok(Math.abs(runner.z - z + raidRoadTravel(RAID_HZ) - forward) < 0.001);
  }
});
test('braking and release integrate the same speed ramp in simulation and camera prediction', () => {
  const { match, send } = battle();
  const r = match.runners[0];
  for (const [brake, ticks] of [
    [1, 9],
    [0, 12],
  ]) {
    assert.ok(send(0, 'move', { side: 0, brake }));
    const startZ = r.z;
    const halfway = raidRunnerPositionAfter(r, 0.5).z;
    for (let i = 0; i < ticks; i++) {
      const predicted = raidRunnerPositionAfter(r, 1).z;
      match.step();
      assert.equal(r.z, predicted);
      if (!i)
        assert.ok(brake ? halfway > startZ && halfway < r.z : halfway < startZ && halfway > r.z);
    }
    assert.ok(Math.abs(r.appliedBrake - brake) < 1e-8);
    assert.ok(Math.abs(r.z - startZ + (0.7 * ticks) / RAID_HZ) < 1e-8);
  }
});

test('ordinary jump reaches its measured apex and lands after 22 ticks', () => {
  const { match, send } = battle('kaiken');
  const r = match.runners[0];
  assert.ok(send(0, 'jump'));
  assert.equal(raidRunnerHeight(r), 0);
  advance(match, 11);
  assert.equal(raidRunnerHeight(r), 3.2);
  assert.equal(send(0, 'jump'), false);
  advance(match, 11);
  assert.equal(raidRunnerHeight(r), 0);
  assert.ok(send(0, 'jump'));
});

test('out-of-range or malformed steering preserves both previous axes', () => {
  const { match, send } = battle();
  assert.ok(send(0, 'move', { side: -0.6, brake: 0.4 }));
  for (const payload of [
    { side: 1.01, brake: 0 },
    { side: -1.01, brake: 0 },
    { side: NaN, brake: 0 },
    { side: '0', brake: 0 },
    { side: 0, brake: -0.01 },
    { side: 0, brake: 1.01 },
    { side: 0, brake: Infinity },
    { side: 0, brake: NaN },
    { side: 0, brake: null, walk: true },
  ]) {
    assert.equal(send(0, 'move', payload), false);
    const { side, brake } = match.runners[0];
    assert.deepEqual([side, brake], [-0.6, 0.4]);
  }
});
test('a locked opponent crossing just behind the runner escapes basics but can still be hit by Bolt', () => {
  const { match, send } = battle(['rend', 'abyss', 'longshot', 'jade']);
  const [player, , rival] = match.runners;
  // Keep the wagon outside automatic basic range throughout this crossing.
  for (const r of match.runners) r.z -= 4;
  match.runners[3].z = -40;
  send(0, 'move', { side: 1, walk: true });
  advance(match, 20);
  assert.ok(send(0, 'lock', 2));
  assert.ok(send(2, 'lock', 0));
  send(0, 'move', { side: 0, walk: false });
  send(2, 'move', { side: 0, walk: true });
  for (let i = 0; i < 45 && rival.z >= player.z; i++) match.step();
  assert.ok(rival.z < player.z && player.z - rival.z < 0.45);
  assert.ok(Math.hypot(player.x - rival.x, player.z - rival.z) < HEROES.rend.reach);
  assert.equal(player.target, 2);
  const hpBehind = rival.hp;
  send(2, 'move', { side: 0, walk: false });
  advance(match, 30);
  assert.equal(rival.hp, hpBehind);
  assert.equal(player.basic, 0);
  assert.ok(player.hp < HEROES.rend.hp);
  assert.ok(send(0, 'lock', 2));
  assert.ok(send(0, 'cast', { skill: 1, target: 2 }));
  assert.ok(player.cooldowns[1] > 0);
  match.step();
  assert.equal(hpBehind - rival.hp, 33);
});
test('an opponent beside the runner enters basic attack range only after moving into the forward cone', () => {
  const { match, send } = battle();
  const [player, , rival] = match.runners;
  rival.x = player.x + HEROES.hammer.reach - 0.1;
  send(0, 'move', { side: 1, walk: false });
  match.step();
  send(0, 'move', { side: 0, walk: false });
  assert.ok(send(0, 'lock', 2));
  advance(match, 30);
  assert.ok(Math.hypot(player.x - rival.x, player.z - rival.z) < HEROES.hammer.reach);
  assert.equal(rival.hp, HEROES.longshot.hp);
  assert.equal(player.basic, 0);
  send(0, 'move', { side: 1, walk: true });
  advance(match, 12);
  assert.ok(rival.z - player.z >= Math.abs(rival.x - player.x));
  assert.equal(rival.hp, HEROES.longshot.hp - HEROES.hammer.basicAttack);
});
test('a viewport edge limits player locks but leaves in-range fields and bot vision independent', () => {
  let aspect = 16 / 9;
  const { match, send } = battle(['rend', 'abyss', 'longshot', 'jade'], () => aspect);
  send(0, 'move', { side: 0, walk: true });
  send(3, 'move', { side: -1, walk: true });
  advance(match, 20);
  assert.ok(send(0, 'lock', 2));
  aspect = 0.15;
  assert.equal(send(0, 'cast', { skill: 1, target: 2 }), false);
  assert.ok(send(0, 'cast', { skill: 2, x: 5, z: 0 }));
  assert.ok(match.runners[0].cooldowns[2] > 0);
  assert.ok(send(3, 'lock', 1));
  match.step();
  assert.equal(match.runners[0].target, null);
  assert.equal(match.runners[3].target, 1);
  aspect = 16 / 9;
  assert.ok(send(0, 'lock', 2));
});
test('targeted attacks and wards can use the extra aiming view while basic locks keep the running view', () => {
  const { match, send } = battle(['rend', 'jade', 'longshot', 'abyss']);
  const [player, ally, rival] = match.runners;
  player.z = 6;
  ally.z = 6;
  rival.x = player.x;
  rival.z = 0;
  assert.equal(match.lock(0, 2), false);
  assert.equal(match.previewSkill(0, 1, null, 2).status, 'ready');
  assert.ok(send(0, 'cast', { skill: 1, target: 2 }));
  player.z = 0;
  assert.equal(match.previewSkill(1, 0, null, 0).status, 'ready');
  assert.ok(send(1, 'cast', { skill: 0, ally: 0 }));
  player.cooldowns[1] = 0;
  rival.z = -15.5;
  assert.equal(match.previewSkill(0, 1, null, 2).status, 'needTarget');
  assert.equal(send(0, 'cast', { skill: 1, target: 2 }), false);
});
test('bots can target a closer opponent behind them with skills while that opponent is on camera', () => {
  const { match, send } = battle();
  // Enter the rear runner's skirmish phase with the starting formation intact.
  for (const r of match.runners) send(r.slot, 'move', { side: 0, brake: 0.4 });
  advance(match, 216);
  for (const r of match.runners) send(r.slot, 'move', { side: 0, brake: 0 });
  send(0, 'move', { side: 0, walk: true });
  send(3, 'move', { side: -1, walk: false });
  advance(match, 12);
  send(3, 'move', { side: -1, walk: true });
  advance(match, 16);
  const bot = match.runners[3];
  assert.ok(match.runners[0].z < bot.z);
  assert.ok(match.canTarget(3, 1));
  const orders = [];
  driveRaidBots(match, (slot, action, payload) => {
    if (slot === 3 && action === 'lock') orders.push(payload);
  });
  assert.deepEqual(orders, [0]);
});
test('the warned wagon lane can be avoided by jumping or sidestepping', () => {
  function hit(mode) {
    const { match, send } = battle();
    advance(match, 60);
    assert.equal(match.hazard.x, match.runners[0].x);
    if (mode === 'side') send(0, 'move', { side: -1, walk: false });
    advance(match, 18);
    if (mode === 'jump') {
      assert.ok(send(0, 'jump'));
      assert.equal(send(0, 'jump'), false);
    }
    const before = match.runners[0].hp;
    advance(match, 12);
    return before - match.runners[0].hp;
  }
  assert.ok(hit('stand') > 0);
  assert.equal(hit('jump'), 0);
  assert.equal(hit('side'), 0);
});
test('PvP earns rage and a knockout, then the defeated runner rejoins behind the wagon', () => {
  const { match, send } = battle(['rend', 'bastion', 'longshot', 'jade']);
  const victim = match.runners[2];
  for (const slot of [0, 1]) send(slot, 'move', { side: 0, walk: true });
  advance(match, 20);
  const wagonDamage = [...match.damage];
  for (const slot of [0, 1]) {
    send(slot, 'lock', 2);
    send(slot, 'cast', { skill: 1, target: victim.slot });
    send(slot, 'cast', { skill: 2, x: victim.x, z: victim.z });
  }
  match.step();
  assert.equal(match.result, null);
  assert.equal(victim.hp, 0);
  const chargeAtKnockout = victim.rage;
  assert.ok(chargeAtKnockout > 0 && chargeAtKnockout < 100);
  assert.deepEqual(match.damage, wagonDamage);
  assert.equal(match.runners[0].kills + match.runners[1].kills, 1);
  assert.equal(victim.deaths, 1);
  assert.equal(match.runners[0].assists + match.runners[1].assists, 1);
  assert.equal(send(2, 'jump'), false);
  assert.equal(victim.respawn, 10 * RAID_HZ);
  const beforeRespawn = victim.wagonDamage;
  advance(match, raidRespawnTicks(victim.deaths) - 1);
  assert.equal(victim.respawn, 1);
  assert.equal(victim.hp, 0);
  assert.equal(victim.rage, chargeAtKnockout);
  assert.equal(send(2, 'cast', { skill: 1, target: 'wagon' }), false);
  assert.equal(victim.wagonDamage, beforeRespawn);
  match.step();
  assert.equal(victim.respawn, 0);
  assert.equal(victim.hp, HEROES[victim.hero].hp);
  assert.equal(victim.rage, chargeAtKnockout);
  assert.ok(victim.z < 0);
});
test('each rival awaiting respawn boosts only wagon hits until that rival returns', () => {
  const { match, send } = battle(['bastion', 'rime', 'bastion', 'jade']);
  const [caster, ally, first, second] = match.runners;
  for (const runner of match.runners) runner.basic = 100;
  function hitWagon(slot) {
    match.runners[slot].cooldowns[1] = 0;
    assert.ok(send(slot, 'cast', { skill: 1, target: 'wagon' }));
  }
  function expectHit(expected) {
    const before = caster.wagonDamage;
    hitWagon(0);
    match.step();
    assert.equal(caster.wagonDamage - before, expected);
    assert.equal(match.damage[0], caster.wagonDamage + ally.wagonDamage);
  }
  expectHit(30);
  first.hp = 1;
  // Queue the lethal hit first. The wagon hit in this same tick still deals base damage.
  assert.ok(send(1, 'cast', { skill: 1, target: first.slot }));
  expectHit(30);
  assert.equal(first.hp, 0);
  const pvpHp = second.hp;
  assert.ok(send(1, 'cast', { skill: 2, x: second.x, z: second.z }));
  expectHit(35);
  assert.equal(pvpHp - second.hp, 30);
  second.hp = 1;
  ally.cooldowns[1] = 0;
  assert.ok(send(1, 'cast', { skill: 1, target: second.slot }));
  expectHit(35);
  assert.equal(second.hp, 0);
  expectHit(39);
  first.respawn = 1;
  expectHit(35);
  assert.equal(first.respawn, 0);
  second.respawn = 1;
  first.z = 0;
  hitWagon(first.slot);
  expectHit(30);
  assert.equal(first.wagonDamage, 30);
});
test('each runner starts at ten seconds, adds five per knockout and caps at thirty-five', () => {
  const { match, send } = battle(['rend', 'rime', 'longshot', 'abyss']);
  const [caster, , first, second] = match.runners;
  function knockOut(victim, seconds) {
    victim.hp = 1;
    caster.cooldowns[1] = 0;
    assert.ok(send(0, 'cast', { skill: 1, target: victim.slot }));
    match.step();
    assert.equal(victim.respawn, seconds * RAID_HZ);
    victim.respawn = 1;
    match.step();
    assert.equal(victim.respawn, 0);
  }
  for (const seconds of [10, 15, 20, 25, 30, 35, 35]) knockOut(first, seconds);
  knockOut(second, 10);
  assert.equal(first.deaths, 7);
  assert.equal(second.deaths, 1);
});
// Use actual hostile bolts and an ally heal to build a nearly full meter without assigning rage.
function takeBoltsUntilOneHitFromFull(match, send) {
  const [player, healer, attacker] = match.runners;
  const damage = HEROES[attacker.hero].power * 3;
  const hits = Math.ceil(raidRageDamageToFull(player.hero) / damage) - 1;
  for (let i = 0; i < hits; i++) {
    attacker.cooldowns[1] = 0;
    assert.ok(send(attacker.slot, 'cast', { skill: 1, target: player.slot }));
    match.step();
    healer.cooldowns[1] = 0;
    const before = player.hp;
    const charge = player.rage;
    assert.ok(send(healer.slot, 'cast', { skill: 1, target: player.slot }));
    assert.ok(player.hp > before);
    assert.equal(player.rage, charge);
  }
  assert.ok(player.rage > 0 && player.rage < 100);
}

test('opposing hits unlock one ultimate and attacking the wagon spends the charge', () => {
  const { match, send } = battle(['hammer', 'alice', 'bastion', 'rime']);
  const [player] = match.runners;
  for (const r of match.runners) r.basic = 100;
  assert.equal(player.rage, 0);
  assert.equal(send(0, 'cast', { skill: 3, target: 'wagon' }), false);
  takeBoltsUntilOneHitFromFull(match, send);
  assert.equal(send(0, 'cast', { skill: 3, target: 'wagon' }), false);
  assert.ok(send(3, 'cast', { skill: 1, target: player.slot }));
  match.step();
  assert.equal(player.rage, 100);
  assert.ok(player.hp > 0);
  assert.equal(send(0, 'cast', { skill: 3, target: 1 }), false);
  assert.equal(player.rage, 100);
  assert.equal(player.cooldowns[3], 0);
  assert.equal(send(0, 'cast', { skill: 3 }), false);
  assert.equal(send(0, 'cast', { skill: 3, target: 'wagon' }), true);
  assert.equal(player.rage, 0);
  assert.equal(send(0, 'cast', { skill: 3, target: 'wagon' }), false);
  match.step();
  assert.ok(match.damage[0] > 0);
  assert.equal(player.rage, 0);
});
test('a wagon hit gives no charge while its hazard charges from health lost', () => {
  const { match, send } = battle(['rend', 'abyss', 'longshot', 'jade']);
  const player = match.runners[0];
  send(0, 'move', { side: -1, walk: true });
  assert.ok(send(0, 'cast', { skill: 1, target: 'wagon' }));
  match.step();
  assert.equal(match.damage[0], 33);
  assert.equal(player.rage, raidRageGain(player.hero, HEROES.rend.hp - player.hp));
  advance(match, 88);
  const { rage, hp } = player;
  match.step();
  assert.equal(hp - player.hp, 26);
  assert.equal(player.rage, Math.min(100, rage + raidRageGain(player.hero, 26)));
});
test('taking a ground strike can ready Fury for a visible rear rival', () => {
  const { match, send } = battle(['rend', 'alice', 'bastion', 'rime']);
  const [player, , flank, rear] = match.runners;
  for (const r of match.runners) r.basic = 100;
  rear.x = player.x;
  takeBoltsUntilOneHitFromFull(match, send);
  const before = player.hp;
  assert.ok(send(2, 'cast', { skill: 2, x: player.x, z: player.z }));
  assert.ok(send(0, 'cast', { skill: 1, target: flank.slot }));
  assert.ok(send(0, 'cast', { skill: 2, x: (flank.x + rear.x) / 2, z: (flank.z + rear.z) / 2 }));
  match.step();
  assert.equal(player.hp, before - HEROES.bastion.power * 3);
  assert.equal(player.rage, 100);
  assert.equal(rear.hp, HEROES.rime.hp - 33);
  assert.equal(rear.rage, raidRageGain(rear.hero, 33));
  const { rage, hp } = rear;
  assert.ok(send(0, 'cast', { skill: 3, target: rear.slot }));
  match.step();
  assert.equal(rear.hp, 0);
  assert.equal(rear.rage, Math.min(100, rage + raidRageGain(rear.hero, hp)));
  assert.equal(player.rage, 0);
});
test('a full shield block and a self-heal both leave rage unchanged', () => {
  const full = battle(['jade', 'hammer', 'bastion', 'longshot']);
  for (const r of full.match.runners) r.basic = 10;
  assert.ok(full.send(0, 'cast', { skill: 0, ally: 0 }));
  assert.equal(full.match.runners[0].rage, 0);
  assert.ok(full.send(2, 'cast', { skill: 1, target: 0 }));
  full.match.step();
  for (const slot of [0, 2]) assert.equal(full.match.runners[slot].rage, 0);

  const { match, send } = battle('theresa');
  const caster = match.runners[0];
  caster.hp -= 12;
  const before = caster.rage;
  assert.ok(send(0, 'cast', { skill: 0 }));
  assert.equal(caster.hp, HEROES.theresa.hp);
  assert.equal(caster.rage, before);
});
test('Abyss aims the silencing orb and delays Distortion on its road tile; Jade shields a wounded ally', () => {
  const { match, send } = battle('jade');
  const [jade, ally, abyss, other] = match.runners;
  for (const r of match.runners)
    Object.assign(r, { basic: 500, x: 0, brake: 0.4, appliedBrake: 0.4 });
  jade.x = other.x = 6;
  abyss.z = 0;
  ally.z = 4;
  assert.equal(send(0, 'cast', { skill: 0, ally: 3 }), false);
  assert.equal(send(abyss.slot, 'cast', { skill: 0, target: ally.slot }), false);
  assert.ok(send(abyss.slot, 'cast', { skill: 0, dx: 0, dz: 1 }));
  assert.ok(send(abyss.slot, 'cast', { skill: 1, x: ally.x, z: ally.z + raidRoadTravel(RAID_HZ) }));
  advance(match, 10);
  assert.ok(ally.silenced && !ally.slowed);
  assert.equal(send(ally.slot, 'cast', { skill: 0 }), false);
  const before = ally.hp;
  assert.ok(send(0, 'cast', { skill: 0, ally: 1 }));
  assert.ok(ally.barrier && ally.hp === before);
  const protection = ally.barrier.amount;
  advance(match, 20);
  assert.equal(ally.slowed, 2 * RAID_HZ);
  assert.equal(ally.barrier.amount, protection - HEROES.abyss.power * 3 * 1.25);
  advance(match, 10);
  assert.ok(send(ally.slot, 'cast', { skill: 0 }));
});
test('lead changes count settled overtakes across ties, excluding first scores and within-tick hits', () => {
  const { match, send } = battle(['bastion', 'rime', 'bastion', 'theresa']);
  function score(slot, skill) {
    assert.ok(send(slot, 'cast', skill === 2 ? { skill, ...WAGON } : { skill, target: 'wagon' }));
  }
  function settled(damage, changes) {
    match.step();
    assert.deepEqual(match.damage, damage);
    assert.equal(match.leadChanges, changes);
  }
  score(2, 1);
  score(0, 1);
  settled([30, 30], 0);
  score(1, 1);
  settled([60, 30], 0);
  Object.assign(match.runners[3], { x: 0, z: 8, basic: 90 });
  score(3, 1);
  advance(match, match.runners[3].dash.ticks - 1);
  settled([60, 60], 0);
  score(2, 2);
  settled([60, 90], 1);
  score(0, 2);
  settled([90, 90], 1);
  score(1, 2);
  settled([120, 90], 2);
});

test('holding both teams back ends the full three minutes on wagon damage, including an exact tie', () => {
  for (const scored of [true, false]) {
    const { match, send } = battle(['bastion', 'hammer', 'rime', 'rend']);
    for (const runner of match.runners) runner.z = -4;
    if (scored) assert.ok(send(0, 'cast', { skill: 2, ...WAGON }));
    for (let i = 0; i < ROUND_TICKS; i++) {
      for (const r of match.runners)
        send(r.slot, 'move', { side: r.team === 0 ? -1 : 1, walk: true });
      match.step();
      if (i < ROUND_TICKS - 1) assert.equal(match.result, null);
    }
    assert.deepEqual(match.result, { reason: 'time', winner: scored ? 0 : 'draw' });
    assert.equal(match.leadChanges, 0);
  }
});
test('a bot-assisted round can destroy the wagon early and the result freezes the session', () => {
  const { match, send } = battle(['rend', 'rime', 'bastion', 'jade']);
  for (let i = 0; i < ROUND_TICKS && !match.result; i++) {
    driveRaidBots(match, send);
    send(0, 'cast', { skill: 3, target: 'wagon' });
    send(0, 'cast', { skill: 1, target: 'wagon' });
    send(0, 'cast', { skill: 2, ...WAGON });
    match.step();
  }
  assert.equal(match.result.reason, 'destruction');
  assert.ok(match.tick < ROUND_TICKS);
  assert.ok(match.damage[match.result.winner] >= WAGON_HP);
  const finished = JSON.stringify([match.tick, match.damage, match.runners]);
  assert.equal(send(0, 'jump'), false);
  advance(match, 90);
  assert.equal(JSON.stringify([match.tick, match.damage, match.runners]), finished);
});

test('free-aim shots ignore the lock, accept empty space, and spend cooldown on a miss', () => {
  for (const [hero, skill] of [
    ['flare', 0],
    ['longshot', 0],
  ]) {
    const { match, send } = battle(hero);
    for (const payload of [
      {},
      { target: 'wagon' },
      { dx: 0, dz: 0 },
      { dx: NaN, dz: 1 },
      { dx: Infinity, dz: 0 },
    ])
      assert.equal(send(0, 'cast', { skill, ...payload }), false);
    const aim = match.previewSkill(0, skill, { x: -55, z: 0 }, 'wagon');
    assert.deepEqual(
      [aim.kind, aim.status, aim.target, aim.count],
      ['direction', 'ready', undefined, undefined],
    );
    assert.ok(send(0, 'cast', { skill, dx: -1, dz: 0 }));
    assert.equal(match.runners[0].target, 'wagon');
    assert.ok(match.runners[0].cooldowns[skill] > 0);
    assert.equal(match.projectiles.length, hero === 'flare' ? 1 : 7);
    const control = battle(hero).match;
    advance(control, 40);
    advance(match, 40);
    assert.equal(match.projectiles.length, 0);
    assert.deepEqual(match.damage, control.damage);
    assert.deepEqual(
      match.runners.map((r) => r.hp),
      control.runners.map((r) => r.hp),
    );
  }
});
test('a runner can dodge a fireball in flight or run into a shot aimed ahead', () => {
  for (const lead of [0, 0.8]) {
    const { match, send } = battle('flare');
    const [player, , rival] = match.runners;
    // Isolate a direct hit from explosions on the adjacent rival.
    match.runners[3].x = -6;
    send(2, 'move', { side: 0, brake: 1 });
    advance(match, 9);
    const hp = rival.hp;
    assert.ok(send(0, 'cast', { skill: 0, dx: rival.x - player.x, dz: rival.z - player.z - lead }));
    match.step();
    assert.equal(rival.hp, hp);
    advance(match, 7);
    assert.equal(rival.hp, lead ? hp - 30 : hp);
  }
});

test('both bot formations open on the wagon and space their casts across all four loadouts', () => {
  for (const hero of HERO_IDS) {
    const { match, send } = battle(hero);
    const lastCast = new Map();
    for (let i = 0; i < 8 * RAID_HZ; i++) {
      driveRaidBots(match, (slot, action, payload) => {
        if (action === 'lock' && i < RAID_HZ) assert.equal(payload, 'wagon');
        if (action === 'cast') {
          assert.ok(i >= RAID_HZ);
          assert.ok(i - (lastCast.get(slot) ?? -Infinity) >= 32);
          lastCast.set(slot, i);
        }
        send(slot, action, payload);
      });
      match.step();
    }
    assert.equal(lastCast.size, 3);
  }
});
test('each loadout contests wagon damage per active team member with one objective skill every 1.5 seconds', () => {
  for (const hero of HERO_IDS) {
    const { match, send } = battle(hero);
    const activeTicks = [0, 0];
    while (!match.result) {
      for (const runner of match.runners) if (!runner.respawn) activeTicks[runner.team]++;
      driveRaidBots(match, send);
      if (match.tick % 45 === 0) {
        const r = match.runners[0];
        const priority = [3];
        const towers = r.heroView.turrets;
        if (towers && !towers.some((t) => Math.hypot(t.x - WAGON.x, t.z - WAGON.z) <= 6))
          priority.length = 0;
        if (hero === 'rildin') {
          // Advance closes on the road while the wagon keeps moving. Weave basics once in reach.
          const distance = Math.hypot(WAGON.x - r.x, WAGON.z - r.z);
          if (distance > raidBasicReach(r, match.tick)) priority.push(2);
          if (distance <= match.skillRange(0, 0).range) priority.push(0);
        } else if (hero === 'longshot') {
          priority.push(1, 0);
        } else if (hero === 'jade') {
          const carrier = match.runners[r.lastWard ?? r.slot];
          const gap = Math.hypot(WAGON.x - carrier.x, WAGON.z - carrier.z);
          if (gap > 8) priority.length = 0;
          if (gap <= 6) priority.push(1);
          if (gap <= 7) priority.push(2);
          priority.push(0);
        } else priority.push(1, 2, 0);
        for (const skill of priority) {
          const kind = raidAimKind(hero, skill);
          const gap = Math.hypot(WAGON.x - r.x, WAGON.z - r.z);
          const placement =
            towers && gap > 5.99
              ? { x: r.x + ((WAGON.x - r.x) * 5.99) / gap, z: r.z + ((WAGON.z - r.z) * 5.99) / gap }
              : WAGON;
          const payload =
            kind === 'field' || kind === 'leap'
              ? { skill, ...placement }
              : kind === 'direction'
                ? { skill, dx: WAGON.x - r.x, dz: WAGON.z - r.z }
                : kind === 'target'
                  ? { skill, target: 'wagon' }
                  : kind === 'ward'
                    ? { skill, ally: r.slot }
                    : { skill };
          if (send(0, 'cast', payload)) break;
        }
      }
      match.step();
    }
    // On a time finish no team necessarily reaches WAGON_HP. Compare the damage per
    // living runner-tick actually achieved by the two teams, and check match pace separately.
    const rates = activeTicks.map((ticks, team) => match.damage[team] / ticks);
    assert.ok(Math.min(...rates) >= Math.max(...rates) * 0.75, hero + ' ' + rates);
    assert.ok(match.damage[0] + match.damage[1] >= WAGON_HP, hero + ' ' + match.damage);
  }
});

test('Hammer slams at his feet and each whirlwind pulse can reach a new opponent as he moves', () => {
  const { match, send } = battle('hammer');
  const [hammer, , first, second] = match.runners;
  for (const r of match.runners) {
    r.basic = 300;
    r.brake = 0.4;
  }
  hammer.x = hammer.z = first.x = first.z = second.z = 0;
  first.x = -3;
  second.x = 7;
  assert.equal(send(0, 'cast', { skill: 0, target: 2 }), false);
  assert.equal(send(0, 'cast', { skill: 2, ...WAGON }), false);
  assert.ok(send(0, 'cast', { skill: 0 }));
  match.step();
  assert.equal(first.hp, HEROES[first.hero].hp - HEROES.hammer.power * 3);
  assert.ok(first.slowed && !first.staggered);
  assert.equal(second.hp, HEROES[second.hero].hp);
  assert.ok(send(0, 'cast', { skill: 2 }));
  assert.ok(send(0, 'move', { side: 1, brake: 0.4 }));
  advance(match, 14);
  assert.equal(second.hp, HEROES[second.hero].hp);
  advance(match, 1);
  assert.equal(second.hp, HEROES[second.hero].hp - 18);
  const firstHp = first.hp;
  advance(match, 45);
  assert.equal(first.hp, firstHp);
  assert.equal(second.hp, HEROES[second.hero].hp - 72);
  assert.equal(hammer.spinTicks, 0);
  advance(match, 15);
  assert.equal(second.hp, HEROES[second.hero].hp - 72);
});

test('Hammer leaps to the selected road tile, then damages and launches only rivals in the landing area', () => {
  const { match, send } = battle();
  const [hammer, ally, rival, evader] = match.runners;
  const point = { x: 2, z: 3 };
  const aim = match.previewSkill(0, 1, point);
  assert.deepEqual(
    [aim.kind, aim.status, aim.range, aim.radius, aim.count],
    ['leap', 'ready', 13, 5, undefined],
  );
  for (const payload of [
    {},
    { target: 'wagon' },
    { dx: 1, dz: 0 },
    { x: Infinity, z: 0 },
    { x: hammer.x + 13.01, z: 0 },
  ])
    assert.equal(send(0, 'cast', { skill: 1, ...payload }), false);
  assert.equal(hammer.cooldowns[1], 0);
  assert.ok(send(0, 'cast', { skill: 1, ...point }));
  assert.ok(send(0, 'move', { side: -1, brake: 1 }));
  assert.equal(send(0, 'jump'), false);
  assert.equal(send(0, 'cast', { skill: 1, target: 2 }), false);
  evader.z = -3;
  send(evader.slot, 'move', { side: 1, brake: 1 });
  const hp = rival.hp;
  const predicted = raidRunnerPositionAfter(hammer, 1);
  match.step();
  assert.deepEqual({ x: hammer.x, z: hammer.z }, predicted);
  advance(match, 6);
  assert.ok(hammer.x > -1.6 && hammer.x < point.x && raidRunnerHeight(hammer) > 2);
  advance(match, RAID_LEAP_TICKS - 8);
  assert.equal(rival.hp, hp);
  assert.equal(rival.slowed, 0);
  assert.ok(!match.actions.some((c) => c.slot === 0));
  match.step();
  assert.deepEqual(
    [hammer.x, hammer.z, raidRunnerHeight(hammer), hammer.leap],
    [point.x, point.z - raidRoadTravel(RAID_LEAP_TICKS), 0, null],
  );
  assert.equal(rival.hp, hp - 24);
  assert.equal(rival.jumping, RAID_HZ);
  assert.equal(evader.jumping, 0);
  assert.equal(ally.jumping, 0);
  assert.equal(match.actions.filter((c) => c.slot === 0 && c.skill === 1).length, 1);
  match.step();
  assert.equal(rival.jumping, RAID_HZ - 1);
  assert.equal(match.actions.filter((c) => c.slot === 0 && c.skill === 1).length, 1);
  assert.ok(hammer.x < point.x);
});
test('an empty leap lands outside the running lanes and returns smoothly, while a knockout cancels touchdown', () => {
  const { match, send } = battle();
  const [hammer] = match.runners;
  const end = { x: hammer.x - 10, z: hammer.z };
  assert.ok(send(0, 'cast', { skill: 1, ...end }));
  advance(match, RAID_LEAP_TICKS);
  assert.equal(hammer.x, end.x);
  match.step();
  assert.ok(hammer.x > end.x && hammer.x - end.x <= 4.8 / RAID_HZ + 1e-9);
  const control = battle().match;
  advance(control, RAID_LEAP_TICKS + 1);
  assert.deepEqual(match.damage, control.damage);
  assert.deepEqual(
    match.runners.slice(2).map((r) => r.hp),
    control.runners.slice(2).map((r) => r.hp),
  );

  const other = battle(['hammer', 'abyss', 'rend', 'rime']);
  const [caster, , rival] = other.match.runners;
  caster.hp = 5;
  assert.ok(other.send(0, 'cast', { skill: 1, x: rival.x, z: rival.z }));
  assert.ok(caster.leap);
  assert.ok(other.send(2, 'cast', { skill: 1, target: 0 }));
  advance(other.match, RAID_LEAP_TICKS + 1);
  assert.ok(caster.respawn > 0 && !caster.leap);
  assert.ok(!other.match.actions.some((c) => c.slot === 0 && c.skill === 1));
});
