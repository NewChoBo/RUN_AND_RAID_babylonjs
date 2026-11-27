import assert from 'node:assert/strict';
import test from 'node:test';
import { battleOutfits, battleOutfit } from '../../src/content/raid/battle-outfits.ts';
import { HERO_IDS } from '../../src/game/raid/heroes/hero-id.ts';
import { RaidSimulation } from '../../src/game/raid/raid-simulation.ts';
import { RaidMatch } from '../../src/game/raid/raid-match.ts';
import { RaidRound } from '../../src/game/raid/raid-round.ts';
import {
  isRaidRoster,
  applyPick,
  applyTurnPick,
  nextDraftClock,
  pickNumber,
  pickTimeMs,
  readDraftSnapshot,
  readDraftChoice,
  readyTimeMs,
  timeoutPick,
  draftMembers,
  draftMessage,
  draftMessageLimit,
  draftTeammates,
} from '../../src/game/raid/raid-draft.ts';

const players = ['jade', 'rend', 'bastion', 'rime'].map((hero, i) => ({
  actor: [8, 12, 20, 25][i],
  hero,
}));
test('the three sword users and moving Hammer spin replay from the same four-player inputs', () => {
  const seats = ['rildin', 'kaiken', 'swift', 'hammer'].map((hero, i) => ({ hero, actor: i + 1 }));
  const host = new RaidRound(seats),
    guest = new RaidRound(seats);
  for (const [actor, payload] of [
    [1, { skill: 1 }],
    [2, { skill: 1, dx: -1, dz: 0 }],
    [3, { skill: 1, target: 2 }],
    [4, { skill: 2 }],
  ])
    assert.ok(host.enqueue(actor, { seq: 1, action: 'cast', payload }));
  const start = host.advance(1);
  assert.equal(start.frames[0].length, 4);
  assert.ok(guest.replay(start));
  assert.ok(host.enqueue(1, { seq: 2, action: 'cast', payload: { skill: 0 } }));
  for (let i = 0; i < 16; i++) {
    assert.ok(guest.replay(JSON.parse(JSON.stringify(host.advance(6)))));
    assert.deepEqual(guest.match.runners, host.match.runners);
    assert.deepEqual(guest.match.projectiles, host.match.projectiles);
    assert.deepEqual(guest.match.healthChanges, host.match.healthChanges);
    assert.deepEqual(guest.match.damage, host.match.damage);
  }
});
test('two Full Moon taps replay the forward dash and one spin at the interruption point', () => {
  const seats = ['kaiken', 'jade', 'rime', 'longshot'].map((hero, i) => ({ hero, actor: i + 1 }));
  const host = new RaidRound(seats);
  const guest = new RaidRound(seats);
  for (const seq of [1, 2]) {
    assert.ok(host.enqueue(1, { seq, action: 'cast', payload: { skill: 2 } }));
    const frames = host.advance(4);
    assert.equal(frames.frames[0].length, 1);
    assert.ok(guest.replay(JSON.parse(JSON.stringify(frames))));
    assert.deepEqual(guest.match.runners, host.match.runners);
    assert.deepEqual(guest.match.actions, host.match.actions);
  }
  const phases = host.match.actions.filter((a) => a.slot === host.slot(1) && a.skill === 2);
  assert.deepEqual(
    phases.map((a) => a.phase),
    ['dash', 'spin'],
  );
});
test('a team attack request is validated once, guides its bot, replays and expires', () => {
  const roster = players.slice(0, 2);
  const host = new RaidRound(roster),
    peer = new RaidRound(roster);
  const actor = roster[0].actor;
  const own = host.slot(actor),
    enemy = host.slot(roster[1].actor);
  for (const [seq, target] of [own, enemy, 'wagon'].entries())
    assert.ok(host.enqueue(actor, { seq: seq + 1, action: 'call', payload: target }));
  const first = host.advance(6);
  assert.deepEqual(
    first.frames[0].map((o) => o.payload),
    [enemy],
  );
  assert.ok(peer.replay(first));
  assert.equal(host.match.runners[1].target, enemy);
  assert.deepEqual(host.match.calls, peer.match.calls);
  assert.equal(host.match.calls[1], null);
  for (let i = 6; i < 120; i += 6) assert.ok(peer.replay(host.advance(6)));
  assert.equal(host.match.calls[0], null);
  assert.deepEqual(host.match.calls, peer.match.calls);
  assert.deepEqual(host.match.runners, peer.match.runners);
  for (const team of [0, 1])
    assert.equal(
      host.match.damage[team],
      host.match.runners.filter((r) => r.team === team).reduce((sum, r) => sum + r.wagonDamage, 0),
    );
});
test('drag pings address the two stable enemy seats from either team, even outside the camera', () => {
  for (const [actor, team, expected] of [
    [8, 0, [2, 3]],
    [12, 1, [0, 1]],
  ]) {
    for (const [index, intent] of ['enemy1', 'enemy2'].entries()) {
      const host = new RaidRound(players),
        peer = new RaidRound(players);
      for (const round of [host, peer]) round.match.runners[expected[index]].z = -45;
      assert.equal(host.match.canTarget(host.slot(actor), expected[index]), false);
      assert.ok(host.enqueue(actor, { seq: 1, action: 'call', payload: intent }));
      assert.ok(peer.replay(host.advance(1)));
      assert.equal(host.match.calls[team].target, expected[index]);
      assert.equal(host.match.calls[1 - team], null);
      assert.deepEqual(peer.match.calls, host.match.calls);
    }
  }
});
test('movement pings survive replay, guide the team bot and leave human controls alone', () => {
  for (const movement of ['advance', 'retreat']) {
    const host = new RaidRound(players.slice(0, 2)),
      peer = new RaidRound(players.slice(0, 2));
    for (const [seq, payload] of ['invalid', movement, 'enemy1'].entries())
      assert.ok(host.enqueue(8, { seq: seq + 1, action: 'call', payload }));
    const frames = host.advance(6);
    assert.deepEqual(
      frames.frames.flat().map((o) => o.payload),
      [movement],
    );
    assert.ok(peer.replay(frames));
    assert.equal(host.match.calls[0].movement, movement);
    assert.equal(host.match.calls[1], null);
    assert.equal(host.match.runners[1].brake, Number(movement === 'retreat'));
    assert.equal(host.match.runners[0].brake, 0);
    for (let i = 6; i < 120; i += 6) assert.ok(peer.replay(host.advance(6)));
    assert.equal(host.match.calls[0], null);
    assert.deepEqual(peer.match.runners, host.match.runners);
  }
});
test('a ping cannot attack a downed portrait or originate from a downed runner', () => {
  const match = new RaidRound(players).match;
  match.runners[2].respawn = 5;
  assert.equal(match.callTarget(0, 'enemy1'), false);
  assert.equal(match.callTarget(2, 'retreat'), false);
  assert.ok(match.callTarget(0, 'enemy2'));
  match.runners[3].respawn = 5;
  match.step();
  assert.equal(match.calls[0], null);
});
test('two to four players alternate teams and each runner is assigned once', () => {
  for (const count of [2, 3, 4]) {
    const seats = players.slice(0, count);
    const round = new RaidRound(seats);
    assert.deepEqual(
      seats.map((s) => round.slot(s.actor)),
      [0, 2, 1, 3].slice(0, count),
    );
    assert.equal(seats[0].hero, 'jade');
    assert.equal(new Set(round.match.runners.map((r) => r.hero)).size, 4);
  }
  for (const roster of [
    [],
    players.slice(0, 1),
    [...players, players[0]],
    [
      { actor: 3, hero: 'jade' },
      { actor: 3, hero: 'hammer' },
    ],
  ]) {
    assert.equal(isRaidRoster(roster), false);
  }
});
test('draft chat only targets the other current seat on the same team', () => {
  const seats = draftMembers([], [5, 7, 10, 18]);
  assert.deepEqual(draftTeammates(seats, 5), [10]);
  assert.deepEqual(draftTeammates(seats, 18), [7]);
  assert.deepEqual(draftTeammates(seats, 1), []);
  assert.deepEqual(draftTeammates(seats.slice(0, 2), 5), []);
  const afterLeave = draftMembers(seats, [5, 10, 18]);
  assert.deepEqual(draftTeammates(afterLeave, 5), [18]);
  assert.deepEqual(draftTeammates(afterLeave, 10), []);
});

test('draft chat accepts bounded plain text and discards invalid messages', () => {
  assert.equal(draftMessage('  후방\n지원  '), '후방 지원');
  assert.equal(draftMessage('<팀>'), '<팀>');
  assert.equal(draftMessage('x'.repeat(draftMessageLimit)).length, draftMessageLimit);
  for (const value of [null, 7, {}, '   ', 'x'.repeat(draftMessageLimit + 1)])
    assert.equal(draftMessage(value), '');
});
test('the first lock wins, unlocking and leaving free a hero, and a join needs a fresh pick', () => {
  const seats = draftMembers([], [5, 2]);
  assert.equal(isRaidRoster(seats), false);
  assert.equal(applyPick(seats, 5, 'base'), false);
  assert.ok(applyPick(seats, 5, 'drizz'));
  assert.equal(applyPick(seats, 2, 'drizz'), false);
  assert.equal(applyPick(seats, 8, 'froze'), false);
  assert.ok(applyPick(seats, 2, 'froze'));
  assert.ok(isRaidRoster(seats));
  assert.ok(applyPick(seats, 5, null));
  assert.equal(isRaidRoster(seats), false);
  const next = draftMembers(seats, [2, 7]);
  assert.deepEqual(next, [
    { actor: 2, hero: 'froze' },
    { actor: 7, hero: null },
  ]);
  assert.ok(applyPick(next, 7, 'drizz'));
});
test('online turns follow the numbered seats; other players can preview but cannot ready early', () => {
  const seats = draftMembers([], [4, 7, 19, 58]);
  assert.deepEqual(
    seats.map((_, i) => pickNumber(i)),
    [1, 2, 4, 3],
  );
  let clock = null;
  for (const [actor, hero] of [
    [4, 'hammer'],
    [7, 'longshot'],
    [58, 'kali'],
    [19, 'drizz'],
  ]) {
    clock = nextDraftClock(seats, clock, 100);
    assert.deepEqual(clock, { actor, endsAt: 100 + pickTimeMs });
    assert.equal(nextDraftClock(seats, clock, 1000), clock);
    assert.equal(applyTurnPick(seats, clock, actor === 19 ? 4 : 19, hero), false);
    assert.ok(applyTurnPick(seats, clock, actor, hero));
  }
  clock = nextDraftClock(seats, clock, 2000);
  assert.deepEqual(clock, { actor: null, endsAt: 2000 + readyTimeMs });
  assert.equal(nextDraftClock(seats, clock, 2500), clock);
  assert.ok(applyTurnPick(seats, clock, 7, null));
  assert.equal(nextDraftClock(seats, clock, 3000).actor, 7);
});

test('all published appearances can enter a match and a timed-out pick keeps only its own valid outfit', () => {
  for (const item of battleOutfits) {
    const hero = item.group === 'base' ? 'bird' : item.group;
    assert.ok(HERO_IDS.includes(hero));
    assert.equal(battleOutfit(hero, item.id)?.model, item.model);
    assert.deepEqual(readDraftChoice({ hero, outfit: item.id }), { hero, outfit: item.id });
    const seats = [
      { actor: 1, hero: null, preferred: hero, outfit: item.id },
      { actor: 2, hero: 'rend' },
    ];
    timeoutPick(seats, 1);
    assert.ok(isRaidRoster(seats));
    assert.equal(seats[0].outfit, item.id);
  }
  const seats = [
    { actor: 1, hero: 'bird' },
    { actor: 2, hero: null, preferred: 'bird', outfit: 'bird/bigbird#default' },
  ];
  timeoutPick(seats, 2);
  assert.ok(isRaidRoster(seats));
  assert.equal(seats[1].outfit, undefined);
  for (const outfit of ['hammer/doomguard', 'https://example.com/test.glb', 42])
    assert.equal(readDraftChoice({ hero: 'bird', outfit }), null);
});
test('timeouts use the preview if free and preserve the active turn across joins and host changes', () => {
  let seats = draftMembers([], [5, 8, 15]);
  applyPick(seats, 5, 'hammer');
  seats[1].preferred = 'freesia';
  timeoutPick(seats, 8);
  assert.equal(seats[1].hero, 'freesia');
  const active = nextDraftClock(seats, null, 1000);
  seats = draftMembers(seats, [5, 8, 15, 23]);
  assert.equal(nextDraftClock(seats, active, 4000), active);
  const packet = { seats, turn: 15, remaining: active.endsAt - 4000 };
  const migrated = readDraftSnapshot(packet, 10);
  seats = draftMembers(migrated.seats, [8, 15, 23]);
  assert.deepEqual(nextDraftClock(seats, migrated.clock, 20), {
    actor: 15,
    endsAt: 10 + pickTimeMs - 3000,
  });
  seats[1].preferred = 'freesia';
  timeoutPick(seats, 15);
  assert.equal(seats[1].hero, 'hammer');
  assert.equal(nextDraftClock(seats, active, 5000).actor, 23);
  assert.equal(nextDraftClock(seats.slice(0, 1), active, 6000), null);
  for (const patch of [
    { turn: 5 },
    { turn: null },
    { remaining: -1 },
    { remaining: pickTimeMs + 1 },
  ])
    assert.equal(readDraftSnapshot({ ...packet, ...patch }, 0), null);
});
test('each player can fill their own input budget and submit again on the next tick', () => {
  const round = new RaidRound(players);
  const move = (seq) => ({ seq, action: 'move', payload: { side: 0, brake: 0 } });
  for (let seq = 1; seq <= 12; seq++) assert.ok(round.enqueue(8, move(seq)));
  assert.equal(round.enqueue(8, move(13)), false);
  assert.ok(round.enqueue(25, move(1)));
  assert.deepEqual(
    round.advance(2).frames.map((f) => f.length),
    [13, 0],
  );
  assert.ok(round.enqueue(8, move(13)));
});

test('local authority and network replay run the same commands, bots and combat through the result', () => {
  const round = new RaidRound(players.slice(0, 2));
  const local = new RaidSimulation(
    new RaidMatch(round.match.runners.map((r) => r.hero)),
    new Set([0, 2]),
  );
  const guest = new RaidRound(players.slice(0, 2));
  const payload = { side: 0.5, brake: 0 };
  assert.ok(local.dispatch(2, 'move', payload));
  assert.ok(round.enqueue(players[1].actor, { seq: 1, action: 'move', payload }));
  while (!local.match.result) {
    const batch = round.advance(6);
    assert.ok(guest.replay(batch));
    for (const _frame of batch.frames) local.step();
    for (const match of [round.match, guest.match]) {
      assert.equal(match.tick, local.match.tick);
      assert.deepEqual(match.damage, local.match.damage);
      assert.equal(match.leadChanges, local.match.leadChanges);
      assert.deepEqual(match.runners, local.match.runners);
    }
  }
  assert.deepEqual(guest.match.result, local.match.result);
});

test('the host binds input to the sender and a guest reproduces the same complete match with bots', () => {
  const seats = players.slice(0, 2);
  const host = new RaidRound(seats),
    guest = new RaidRound(seats);
  const move = { seq: 1, action: 'move', payload: { side: -0.75, brake: 0.5 }, slot: 0 };
  assert.equal(host.enqueue(300, move), false);
  assert.equal(host.enqueue(12, move), true);
  assert.equal(host.enqueue(12, move), false);
  assert.equal(host.enqueue(12, { seq: 2, action: 'cast', payload: { skill: 99 } }), true);
  const first = host.advance(1);
  assert.equal(first.frames[0].length, 1);
  assert.equal(first.frames[0][0].slot, 2);
  assert.equal(guest.replay(first), true);
  assert.equal(guest.replay(first), false);
  assert.equal(guest.match.runners[2].side, -0.75);
  assert.equal(guest.match.runners[0].side, 0);
  while (!host.match.result)
    assert.equal(guest.replay(JSON.parse(JSON.stringify(host.advance(6)))), true);
  for (const key of ['runners', 'tick', 'damage', 'actions', 'result', 'projectiles'])
    assert.deepEqual(guest.match[key], host.match[key]);
});
