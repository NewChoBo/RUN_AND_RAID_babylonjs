import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { lobbyHtml } from '../../tools/lobby-html.js';
import { ORIGINAL_HERO_IDS } from '../../src/game/raid/heroes/hero-id.ts';
import { battleIconIndex } from '../../src/ui/raid-skill-icon.ts';
import icons from '../../src/content/raid/skill-icons.json' with { type: 'json' };

test('the assembled game has unique IDs and every static icon points to a symbol in the same document', () => {
  const entry = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const html = lobbyHtml.transformIndexHtml.handler(entry, { server: true });
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
  assert.equal(ids.length, new Set(ids).size);
  const symbols = new Set([...html.matchAll(/<symbol\s+id="([^"]+)"/g)].map(([, id]) => id));
  const refs = [...html.matchAll(/<use\s+href="#([^"]+)"/g)].map(([, id]) => id);
  assert.ok(refs.includes('ui-settings'));
  assert.ok(refs.includes('ui-close'));
  for (const ref of refs) assert.ok(symbols.has(ref), ref);
});

test('all original heroes use their own numbered skill art, including both Magnus stances', () => {
  for (const hero of ORIGINAL_HERO_IDS) {
    const slots = [0, 1, 2, 3];
    const indices = slots.map((slot) => battleIconIndex(hero, slot));
    assert.deepEqual(indices, hero === 'magnus' ? [1, 2, 3, 8] : [1, 2, 3, 4]);
    if (hero === 'magnus')
      assert.deepEqual(
        slots.map((slot) => battleIconIndex(hero, slot, true)),
        [5, 6, 7, 4],
      );
    assert.equal(icons[hero].length, hero === 'magnus' ? 9 : 5);
    assert.equal(new Set(icons[hero]).size, icons[hero].length);
  }
});
