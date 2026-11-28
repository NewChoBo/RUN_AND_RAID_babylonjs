import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { getLocale, resolveLocale, setLocale } from '../../src/content/locales/locale.ts';
import { uiText } from '../../src/content/locales/ui.ts';
import { raidText } from '../../src/content/locales/run-and-raid.ts';
import { characterArt, characterLabel } from '../../src/content/raid/gallery.ts';

test('first visits and unsupported preferences use Korean, and English variants resolve to English', () => {
  for (const value of [null, '', 'ko-KR', 'invalid tag', 'fr']) {
    assert.equal(resolveLocale(value), 'ko');
  }
  assert.equal(resolveLocale('en-US'), 'en');
});

test('every HTML translation marker has UI copy in both languages', () => {
  const templates = new URL('../../src/ui/templates/', import.meta.url);
  const pages = [
    ...['index.html', 'game.html', 'library.html'].map(
      (name) => new URL('../../' + name, import.meta.url),
    ),
    ...readdirSync(templates).map((name) => new URL(name, templates)),
  ];
  const previous = getLocale();
  try {
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      for (const [, key] of html.matchAll(/data-i18n(?:-aria|-alt|-placeholder)?="([^"]+)"/g)) {
        setLocale('ko');
        assert.match(uiText(key), /[가-힣]/, key);
        setLocale('en');
        assert.doesNotMatch(uiText(key), /[가-힣]/, key);
      }
    }
  } finally {
    setLocale(previous);
  }
});

test('the selected language changes room and character labels while preserving original art', () => {
  const previous = getLocale();
  try {
    setLocale('ko');
    const art = characterArt('hammer');
    assert.equal(characterLabel('해머'), '해머');
    assert.equal(raidText('quickMatch'), '빠른 매칭');
    setLocale('en');
    assert.equal(raidText('quickMatch'), 'Quick match');
    assert.equal(characterLabel('롱샷·칼리'), 'Longshot · Kali');
    assert.equal(characterArt('hammer'), art);
  } finally {
    setLocale(previous);
  }
});

test('room and waiting labels display the supplied occupancy in either language', (t) => {
  const previous = getLocale();
  t.after(() => setLocale(previous));
  for (const locale of ['ko', 'en']) {
    setLocale(locale);
    for (const label of ['quickWaiting', 'quickRoomStatus', 'roomStatus']) {
      const message = raidText(label, { code: 'ABC234', count: 3, capacity: 8 });
      assert.match(message, /3\/8/);
      assert.doesNotMatch(message, /\{\w+\}/);
      if (label === 'roomStatus') assert.match(message, /ABC234/);
    }
  }
});
