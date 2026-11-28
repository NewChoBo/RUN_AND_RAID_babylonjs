import assert from 'node:assert/strict';
import test from 'node:test';
import { RAID_CONTROL_RANGES } from '../../src/content/raid/controls.ts';
import {
  createPreferences,
  sanitizePreferences,
  STORAGE_KEY,
} from '../../src/platform/browser/preferences.ts';

test('old controls keep their skill size and save the HUD inset across sessions', () => {
  const values = new Map([[STORAGE_KEY, JSON.stringify({ version: 11, raidSkillSize: 125 })]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const controls = createPreferences(storage);
  assert.equal(controls.get().raidHudPadding, 0);
  controls.set({ ...controls.get(), raidHudPadding: 19 });
  const reloaded = createPreferences(storage);
  assert.equal(reloaded.get().raidHudPadding, 20);
  assert.equal(reloaded.get().raidSkillSize, 125);
  for (const [given, expected] of [
    [-10, 0],
    [30, 24],
    [Infinity, 0],
    ['12', 0],
  ])
    assert.equal(sanitizePreferences({ raidHudPadding: given }).raidHudPadding, expected);
});

test('aim pad sensitivity keeps saved gains and uses the same limits as the settings slider', () => {
  const { min, max, defaultValue } = RAID_CONTROL_RANGES.sensitivity;
  for (const [saved, expected] of [
    [undefined, defaultValue],
    [NaN, defaultValue],
    [min / 2, min],
    [max + 1, max],
    [1.67, 1.67],
  ]) {
    assert.equal(sanitizePreferences({ version: 11, sensitivity: saved }).sensitivity, expected);
  }
});

test('a legacy mute, last audible volume and graphics quality survive a reload', async (t) => {
  const values = new Map([
    ['run-and-raid.audio.effects', 'off'],
    ['run-and-raid.audio.voice', 'off'],
  ]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  const settings = await import('../../src/platform/browser/battle-settings.ts');
  assert.equal(settings.audioVolume(), 0);
  settings.setAudioVolume(37);
  assert.equal(settings.audioVolume(), 37);
  settings.setAudioVolume(0);
  settings.setGraphicsQuality('medium');
  const reloaded = await import('../../src/platform/browser/battle-settings.ts?reload');
  assert.equal(reloaded.audioVolume(), 0);
  assert.equal(reloaded.graphicsQuality(), 'medium');
  reloaded.setAudioEnabled(true);
  assert.equal(reloaded.audioVolume(), 37);
  const audible = await import('../../src/platform/browser/battle-settings.ts?audible');
  assert.equal(audible.audioVolume(), 37);
  assert.equal(values.get('run-and-raid.audio.voice'), 'off');
});
