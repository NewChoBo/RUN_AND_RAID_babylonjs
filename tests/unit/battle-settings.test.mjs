import assert from 'node:assert/strict';
import test from 'node:test';

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
