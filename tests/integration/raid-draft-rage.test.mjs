import assert from 'node:assert/strict';
import test from 'node:test';
import { draftPreset, draftRageLoadout } from '../../src/content/raid/draft-loadout.ts';
import {
  applyTurnPick,
  draftMembers,
  isRaidRoster,
  nextDraftClock,
  readDraftChoice,
  readDraftSnapshot,
  timeoutPick,
} from '../../src/game/raid/raid-draft.ts';
import { RaidRound } from '../../src/game/raid/raid-round.ts';

test('Swift’s selected option is independent of her equipped outfit; Rildin uses the W rank', () => {
  const bunny = '바니걸 스위프트';
  const normal = draftPreset('swift');
  const defaultArtWithBonus = draftPreset('swift', { ...normal, option: bunny });
  assert.equal(defaultArtWithBonus.art, normal.art);
  assert.deepEqual(draftRageLoadout('swift', defaultArtWithBonus), { swiftRageBonus: true });
  assert.equal(
    draftRageLoadout('swift', draftPreset('swift', { ...normal, art: bunny })),
    undefined,
  );
  for (let rank = 1; rank <= 4; rank++) {
    const preset = draftPreset('rildin', { ranks: [1, rank, 1] });
    assert.deepEqual(
      draftRageLoadout('rildin', preset),
      rank === 1 ? undefined : { counterRank: rank },
    );
  }
  assert.equal(draftRageLoadout('hammer', draftPreset('hammer', { ranks: [1, 4, 1] })), undefined);
});

test('a roster transfers ready and timed-out selections to the actor’s simulation slots on every peer', () => {
  const seats = draftMembers([], [9, 12]);
  const ready = readDraftChoice({
    hero: 'rildin',
    outfit: 'rildin/default',
    rageLoadout: { counterRank: 4 },
  });
  assert.ok(
    applyTurnPick(
      seats,
      nextDraftClock(seats, null, 100),
      9,
      ready.hero,
      ready.outfit,
      ready.rageLoadout,
    ),
  );
  const preview = readDraftChoice({
    hero: 'swift',
    outfit: 'swift/default',
    rageLoadout: { swiftRageBonus: true },
  });
  Object.assign(seats[1], {
    preferred: preview.hero,
    outfit: preview.outfit,
    rageLoadout: preview.rageLoadout,
  });
  const snapshot = readDraftSnapshot(
    JSON.parse(JSON.stringify({ seats, turn: 12, remaining: 750 })),
    500,
  );
  timeoutPick(snapshot.seats, 12);
  const host = new RaidRound(snapshot.seats);
  const guest = new RaidRound(JSON.parse(JSON.stringify(snapshot.seats)));
  for (const round of [host, guest]) {
    assert.deepEqual(
      round.match.runners.map((runner) => runner.rageLoadout),
      [{ counterRank: 4 }, {}, { swiftRageBonus: true }, {}],
    );
  }
});

test('claimed previews discard their expired loadout on fallback and invalid wire settings cannot start a round', () => {
  const seats = [
    { actor: 1, hero: 'swift', rageLoadout: { swiftRageBonus: true } },
    {
      actor: 2,
      hero: null,
      preferred: 'swift',
      outfit: 'swift/default',
      rageLoadout: { swiftRageBonus: true },
    },
  ];
  timeoutPick(seats, 2);
  assert.ok(isRaidRoster(seats));
  assert.notEqual(seats[1].hero, 'swift');
  assert.equal(seats[1].rageLoadout, undefined);
  for (const [hero, rageLoadout] of [
    ['rildin', { counterRank: 5 }],
    ['rildin', { counterRank: 1.5 }],
    ['rildin', { counterRank: '4' }],
    ['swift', { swiftRageBonus: 1 }],
    ['swift', { counterRank: 4 }],
    ['hammer', { swiftRageBonus: true }],
    ['hammer', []],
    ['rildin', null],
    ['swift', { swiftRageBonus: true, extra: 'value' }],
  ]) {
    assert.equal(readDraftChoice({ hero, rageLoadout }), null);
    assert.equal(
      isRaidRoster([
        { actor: 1, hero, rageLoadout },
        { actor: 2, hero: 'jade' },
      ]),
      false,
    );
  }
});
