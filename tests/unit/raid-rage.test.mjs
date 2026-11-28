import assert from 'node:assert/strict';
import test from 'node:test';
import { raidRageDamageToFull, raidRageGain } from '../../src/content/raid/rage.ts';
import { RaidHitResolution } from '../../src/game/raid/combat/hit-resolution.ts';
import { ORIGINAL_HERO_IDS } from '../../src/game/raid/heroes/hero-id.ts';
import { HEROES, RaidMatch } from '../../src/game/raid/raid-match.ts';
import { RaidRound } from '../../src/game/raid/raid-round.ts';

function combat(heroes) {
  const { runners } = new RaidMatch(heroes);
  const hits = new RaidHitResolution(
    runners.map((self) => ({ self, stats: HEROES[self.hero] })),
    () => ({}),
    () => {},
  );
  return { runners, hits };
}

test('each original runner charges at its own configured rate from the same hit', () => {
  const rates = new Set();
  for (const hero of ORIGINAL_HERO_IDS) {
    const { runners, hits } = combat([hero]);
    const victim = runners[0];
    hits.enqueue({ from: null, target: 0, amount: 12 });
    hits.resolve(1);
    assert.equal(HEROES[hero].hp - victim.hp, 12);
    assert.equal(victim.rage, raidRageGain(hero, 12), hero);
    if (hero === 'magnus') {
      assert.equal(victim.rage, 0);
    } else {
      assert.ok(victim.rage > 0, hero);
      assert.ok(raidRageDamageToFull(hero) > HEROES[hero].hp, hero + ' fills in a single life');
      rates.add(victim.rage);
    }
  }
  assert.ok(rates.size > 1);
});

test('barriers, mitigation and overkill charge only HP lost while kill and assist rewards stay separate', () => {
  const { runners, hits } = combat(['hammer', 'longshot', 'jade', 'vallet']);
  const [attacker, finisher, victim] = runners;
  victim.shield = 10;
  victim.barrier = { amount: 6, until: 60 };
  victim.hp = 7;
  hits.enqueue({ from: attacker.slot, target: victim.slot, amount: 10 });
  hits.enqueue({ from: attacker.slot, target: victim.slot, amount: 0 });
  hits.resolve(1);
  assert.equal(victim.hp, 7);
  assert.equal(victim.rage, 0);
  hits.enqueue({ from: attacker.slot, target: victim.slot, amount: 6 });
  hits.resolve(2);
  assert.equal(victim.hp, 5);
  assert.equal(victim.rage, raidRageGain(victim.hero, 2));
  hits.enqueue({ from: finisher.slot, target: victim.slot, amount: 1000, skill: 3 });
  hits.enqueue({ from: attacker.slot, target: victim.slot, amount: 40 });
  hits.resolve(3);
  assert.equal(victim.hp, 0);
  assert.equal(victim.rage, raidRageGain(victim.hero, 2) + raidRageGain(victim.hero, 5));
  assert.deepEqual([attacker.assists, finisher.kills, attacker.rage, finisher.rage], [1, 1, 0, 0]);
});

test('single-HP hits and larger hits fill at the same cumulative HP loss across heals', () => {
  const hero = 'froze';
  const threshold = raidRageDamageToFull(hero);
  const { runners, hits } = combat([hero, hero]);
  let batch = 0;
  for (let tick = 1; tick < threshold; tick++) {
    hits.enqueue({ from: null, target: 0, amount: 1 });
    batch++;
    if (batch === HEROES[hero].hp - 1 || tick === threshold - 1) {
      hits.enqueue({ from: null, target: 1, amount: batch });
      batch = 0;
    }
    hits.resolve(tick);
    if (batch === 0) {
      for (const runner of runners) {
        const charge = runner.rage;
        hits.heal(tick, runner, runner.slot, HEROES[hero].hp);
        assert.equal(runner.rage, charge);
      }
    }
  }
  for (const runner of runners) assert.ok(runner.rage > 0 && runner.rage < 100);
  hits.enqueue({ from: null, target: 0, amount: 1 });
  hits.enqueue({ from: null, target: 1, amount: 1 });
  hits.resolve(threshold);
  assert.deepEqual(
    runners.map((r) => r.rage),
    [100, 100],
  );
});

test('Rildin counter rank multiplies the first blocked hit, with normal charge for the next', () => {
  for (const [counterRank, multiplier] of [
    [1, 2],
    [2, 2.5],
    [3, 3],
    [4, 3.5],
  ]) {
    const match = new RaidMatch(['rildin', 'jade', 'rime', 'bastion'], undefined, [
      { counterRank },
    ]);
    const [guard, , first, second] = match.runners;
    for (const r of match.runners) r.basic = 1000;
    assert.ok(match.cast(guard.slot, 1));
    assert.ok(match.cast(first.slot, 1, guard.slot));
    assert.ok(match.cast(second.slot, 1, guard.slot));
    match.step();
    const ordinaryDamage = HEROES[guard.hero].hp - guard.hp;
    assert.equal(ordinaryDamage, HEROES[second.hero].power * 3);
    const parriedDamage = HEROES[first.hero].power * 3;
    assert.equal(
      guard.rage,
      Math.min(
        100,
        raidRageGain(guard.hero, parriedDamage * multiplier) +
          raidRageGain(guard.hero, ordinaryDamage),
      ),
    );
  }
});

test('the Bunny Girl stat option increases Swift’s incoming charge by 20 percent', () => {
  function takenCharge(hero, swiftRageBonus) {
    const match = new RaidMatch([hero, 'jade', 'rend', 'bastion'], undefined, [{ swiftRageBonus }]);
    for (const r of match.runners) r.basic = 1000;
    assert.ok(match.cast(2, 1, 0));
    match.step();
    assert.equal(HEROES[hero].hp - match.runners[0].hp, HEROES.rend.power * 3);
    return match.runners[0].rage;
  }
  assert.ok(Math.abs(takenCharge('swift', true) - takenCharge('swift', false) * 1.2) < 1e-9);
  assert.equal(takenCharge('hammer', true), takenCharge('hammer', false));
});

test('the mode switch stays available to Magnus on zero charge after a hit in multiplayer replay', () => {
  const seats = ['magnus', 'rend', 'jade', 'longshot'].map((hero, i) => ({ hero, actor: i + 1 }));
  const host = new RaidRound(seats);
  const peer = new RaidRound(seats);
  const magnus = host.match.runners[host.slot(1)];
  assert.ok(
    host.enqueue(2, { seq: 1, action: 'cast', payload: { skill: 1, target: magnus.slot } }),
  );
  assert.ok(peer.replay(JSON.parse(JSON.stringify(host.advance(1)))));
  assert.ok(magnus.hp < HEROES.magnus.hp);
  assert.equal(magnus.rage, 0);
  assert.ok(host.enqueue(1, { seq: 1, action: 'cast', payload: { skill: 3 } }));
  assert.ok(peer.replay(JSON.parse(JSON.stringify(host.advance(1)))));
  assert.equal(magnus.heroView.shieldMode, true);
  assert.equal(magnus.rage, 0);
  assert.deepEqual(peer.match.runners, host.match.runners);
});
