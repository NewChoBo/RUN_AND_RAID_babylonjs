import assert from 'node:assert/strict';
import test from 'node:test';
import { ORIGINAL_HERO_IDS } from '../../src/game/raid/heroes/hero-id.ts';
import {
  draftCatalog,
  draftPreset,
  effectFor,
  equipmentPages,
  remainingPoints,
  skinArt,
} from '../../src/content/raid/draft-loadout.ts';

test('all original runners have face art and every selectable skin resolves to its catalog artwork', () => {
  assert.deepEqual(Object.keys(draftCatalog).sort(), [...ORIGINAL_HERO_IDS].sort());
  for (const { face, skins } of Object.values(draftCatalog)) {
    assert.match(face, /^https:/);
    assert.equal(new Set(skins.map((s) => s.art)).size, skins.length);
    for (const skin of skins) {
      assert.ok(skinArt(skin.art));
      if (skin.effect !== null) assert.ok(effectFor(skin.effect));
    }
  }
});

test('skin art, stat option and equipment are independent and only legal point splits survive loading', () => {
  const chosen = { ranks: [1, 1, 4], art: '정장 카이켄', option: '카이켄 기본', gear: 'empty' };
  const preset = draftPreset('kaiken', chosen);
  assert.deepEqual(preset, chosen);
  assert.equal(remainingPoints(preset), 0);
  for (const ranks of [[0, 2, 4], [4, 4, 4], [1, 2.5, 1], [1, 2], 'bad']) {
    assert.equal(remainingPoints(draftPreset('kaiken', { ...chosen, ranks })), 3);
  }
  const other = draftPreset('hammer', { ...chosen, gear: 'removed' });
  assert.equal(other.art, '해머 기본');
  assert.equal(other.option, '해머 기본');
  assert.equal(equipmentPages[other.gear].length, 4);
  assert.equal(draftPreset('freesia').gear, 'empty');
  assert.equal(effectFor(draftCatalog.freesia.skins[0].effect), undefined);
});
