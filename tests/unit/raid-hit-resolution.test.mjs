import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidHitResolution } from '../../src/game/raid/combat/hit-resolution.ts';
import { HEROES, RaidMatch, RAID_HZ, WAGON_HP } from '../../src/game/raid/raid-match.ts';

function fight() {
  const { runners } = new RaidMatch(['rime', 'rend', 'jade', 'bastion']);
  const hits = new RaidHitResolution(
    runners.map((self) => ({ self, stats: HEROES[self.hero] })),
    () => ({}),
    () => {},
  );
  return { hits, runners };
}

test('combat numbers report applied health changes, including lethal hits, overheal and the last wagon HP', () => {
  const { runners } = new RaidMatch(['jade', 'rend', 'rime', 'bastion']);
  const resolution = new RaidHitResolution(
    runners.map((self) => ({ self, stats: HEROES[self.hero] })),
    (slot) => (slot === 3 ? { onIncomingHit: () => true } : {}),
    () => {},
  );
  const [caster, ally, rival] = runners;
  ally.hp -= 3;
  rival.hp = 5;
  rival.shield = 10;
  resolution.damage[0] = WAGON_HP - 2;
  resolution.heal(10, caster, ally.slot, 20);
  resolution.heal(10, caster, ally.slot, 20);
  for (const hit of [
    { from: null, target: 2, amount: 5 },
    { from: 0, target: 2, amount: 50 },
    { from: 0, target: 3, amount: 50 },
    { from: 0, target: 'wagon', amount: 50 },
    { from: 0, target: 'wagon', amount: 50 },
  ])
    resolution.enqueue(hit);
  resolution.resolve(10);
  assert.deepEqual(
    resolution.healthChanges.map(({ from, target, amount }) => [from, target, amount]),
    [
      [0, 1, 3],
      [null, 2, -3],
      [0, 2, -2],
      [0, 'wagon', -2],
    ],
  );
  const impact = resolution.healthChanges[1];
  rival.z += 10;
  assert.notEqual(impact.z, rival.z);
  resolution.resolve(10 + RAID_HZ);
  assert.deepEqual(resolution.healthChanges, []);
});

test('life steal shows the actual self-heal alongside the hit without charging its caster', () => {
  const match = new RaidMatch(['rend', 'jade', 'rime', 'bastion']);
  const [rend, , victim, other] = match.runners;
  rend.hp -= 2;
  other.x = 5;
  for (const r of match.runners) r.basic = 30;
  assert.ok(match.cast(0, 0));
  match.step();
  assert.deepEqual(
    match.healthChanges.map(({ target, amount }) => [target, amount]),
    [
      [victim.slot, -2 * HEROES.rend.power],
      [rend.slot, 2],
    ],
  );
  assert.equal(rend.rage, 0);
});

test('assist credit and the recovery flight share the same inclusive five-second window', () => {
  for (const [age, assists] of [
    [5 * RAID_HZ, 1],
    [5 * RAID_HZ + 1, 0],
  ]) {
    const {
      hits,
      runners: [ally, killer, victim],
    } = fight();
    Object.assign(ally, { hp: 1, rage: 26 });
    Object.assign(killer, { hp: 1, rage: 18 });
    hits.enqueue({ from: ally.slot, target: victim.slot, amount: 1 });
    hits.resolve(10);
    hits.enqueue({ from: killer.slot, target: victim.slot, amount: victim.hp });
    const knockout = 10 + age;
    hits.resolve(knockout);
    assert.equal(ally.assists, assists);
    assert.equal(killer.kills, 1);
    assert.deepEqual(
      hits.healingFlights.map((f) => f.target),
      assists ? [1, 0] : [1],
    );
    assert.ok(
      hits.healingFlights.every((f) => f.started === knockout && f.arrives === knockout + 42),
    );
    const killerRecovery = Math.round(HEROES[killer.hero].hp * 0.16);
    const allyRecovery = assists * Math.round(HEROES[ally.hero].hp * 0.08);
    assert.deepEqual([killer.hp, ally.hp], [1 + killerRecovery, 1 + allyRecovery]);
    const recovery = hits.healthChanges.filter((h) => h.amount > 0);
    assert.ok(recovery.every((h) => h.tick === knockout && h.displayTick === knockout + 42));
    assert.deepEqual(
      recovery.map((h) => [h.target, h.amount]),
      assists
        ? [
            [1, killerRecovery],
            [0, allyRecovery],
          ]
        : [[1, killerRecovery]],
    );
    hits.resolve(knockout);
    assert.deepEqual([killer.hp, ally.hp], [1 + killerRecovery, 1 + allyRecovery]);
    assert.deepEqual(
      hits.healthChanges.filter((h) => h.amount > 0),
      recovery,
    );
    hits.resolve(knockout + 41);
    assert.equal(hits.healingFlights.length, 1 + assists);
    hits.resolve(knockout + 42);
    assert.deepEqual([killer.hp, ally.hp], [1 + killerRecovery, 1 + allyRecovery]);
    assert.equal(hits.healingFlights.length, 0);
    assert.deepEqual([killer.rage, ally.rage], [18, 26]);
  }
});

test('a capped knockout heal applies at the kill and its delayed number survives until the single flight arrives', () => {
  const match = new RaidMatch(['hammer', 'jade', 'longshot', 'bastion']);
  const [killer, ally, victim, other] = match.runners;
  for (const runner of match.runners) Object.assign(runner, { x: 0, z: 0, basic: 999 });
  other.x = 6.5;
  ally.hp = 1;
  victim.hp = 1;
  killer.hp -= 3;
  assert.ok(match.cast(killer.slot, 0));
  match.step();
  assert.equal(match.healingFlights.length, 1);
  const flight = match.healingFlights[0];
  assert.deepEqual(
    [flight.victim, flight.killer, flight.target],
    [victim.slot, killer.slot, killer.slot],
  );
  assert.deepEqual([flight.x, flight.z], [victim.x, victim.z]);
  assert.equal(killer.hp, HEROES.hammer.hp);
  const healed = match.healthChanges.filter((h) => h.amount > 0);
  assert.deepEqual(
    healed.map((h) => [h.tick, h.displayTick, h.from, h.target, h.amount]),
    [[flight.started, flight.arrives, killer.slot, killer.slot, 3]],
  );
  while (match.tick < flight.arrives - 1) match.step();
  killer.hp -= 5;
  match.step();
  assert.equal(killer.hp, HEROES.hammer.hp - 5);
  assert.equal(ally.hp, 1);
  assert.equal(match.healingFlights.length, 0);
  assert.deepEqual(
    match.healthChanges.filter((h) => h.amount > 0),
    healed,
  );
  match.step();
  assert.deepEqual(
    match.healthChanges.filter((h) => h.amount > 0),
    healed,
  );
  assert.equal(killer.rage, 0);
});

test('a recipient dying in flight or on arrival cancels their pending effects without reviving or healing twice', () => {
  for (const [downedSlot, deathTick] of [
    [0, 22],
    [1, 43],
  ]) {
    const { hits, runners } = fight();
    const [killer, ally, victim] = runners;
    killer.hp = ally.hp = 1;
    hits.enqueue({ from: ally.slot, target: victim.slot, amount: 1 });
    hits.enqueue({ from: killer.slot, target: victim.slot, amount: victim.hp });
    hits.resolve(1);
    assert.equal(hits.healingFlights.length, 2);
    hits.enqueue({ from: null, target: downedSlot, amount: runners[downedSlot].hp });
    hits.resolve(deathTick);
    const downed = runners[downedSlot];
    assert.ok(downed.respawn && downed.hp === 0);
    assert.ok(hits.healingFlights.every((f) => f.target !== downedSlot));
    if (deathTick < 43) {
      downed.respawn = 0;
      downed.hp = 1;
      hits.resolve(43);
      assert.equal(downed.hp, 1);
    }
    const survivor = runners[1 - downedSlot];
    assert.equal(
      survivor.hp,
      1 + Math.round(HEROES[survivor.hero].hp * (survivor === killer ? 0.16 : 0.08)),
    );
    assert.equal(hits.healingFlights.length, 0);
  }
});

test('recovery uses HP after all hits in the KO tick, including zero missing HP', () => {
  for (const incoming of ['before', 'after', 'none']) {
    const {
      hits,
      runners: [killer, , rival, other],
    } = fight();
    const wound = { from: other.slot, target: killer.slot, amount: 5 };
    if (incoming === 'before') hits.enqueue(wound);
    hits.enqueue({ from: killer.slot, target: rival.slot, amount: rival.hp });
    if (incoming === 'after') hits.enqueue(wound);
    hits.resolve(10);
    assert.equal(killer.hp, HEROES[killer.hero].hp);
    assert.equal(hits.healingFlights.length, incoming === 'none' ? 0 : 1);
    const gains = hits.healthChanges.filter((h) => h.amount > 0);
    assert.deepEqual(
      gains.map((h) => h.amount),
      incoming === 'none' ? [] : [5],
    );
  }
});

test('traded kills, duplicate lethal hits, wagon destruction and environmental KOs do not award extra recovery', () => {
  const {
    hits,
    runners: [killer, ally, rival, other],
  } = fight();
  hits.enqueue({ from: ally.slot, target: other.slot, amount: 1 });
  hits.enqueue({ from: null, target: other.slot, amount: other.hp });
  hits.enqueue({ from: killer.slot, target: 'wagon', amount: WAGON_HP });
  hits.resolve(1);
  assert.equal(hits.damage[0], WAGON_HP);
  assert.equal(other.deaths, 1);
  assert.equal(ally.assists, 0);
  assert.deepEqual(hits.healingFlights, []);
  killer.hp = rival.hp = 1;
  hits.enqueue({ from: killer.slot, target: rival.slot, amount: rival.hp });
  hits.enqueue({ from: killer.slot, target: rival.slot, amount: rival.hp });
  hits.enqueue({ from: rival.slot, target: killer.slot, amount: killer.hp });
  hits.resolve(2);
  assert.deepEqual([killer.kills, rival.kills, killer.deaths, rival.deaths], [1, 1, 1, 1]);
  assert.deepEqual(hits.healingFlights, []);
  assert.ok(hits.healthChanges.every((h) => h.amount <= 0));
  hits.resolve(44);
  assert.ok(hits.healthChanges.every((h) => h.amount <= 0));
});
