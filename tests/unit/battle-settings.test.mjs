import assert from 'node:assert/strict';
import test from 'node:test';

test('a legacy mute, last audible volume and graphics quality survive a reload', async (t) => {
  const values = new Map([['run-and-raid.audio.effects', 'off']]);
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
  assert.equal(settings.audioVolume('effects'), 0);
  assert.equal(settings.audioVolume('voice'), 100);
  settings.setAudioVolume('effects', 37);
  settings.setAudioVolume('effects', 0);
  settings.setGraphicsQuality('medium');
  const reloaded = await import('../../src/platform/browser/battle-settings.ts?reload');
  assert.equal(reloaded.audioVolume('effects'), 0);
  assert.equal(reloaded.graphicsQuality(), 'medium');
  reloaded.setAudioEnabled('effects', true);
  assert.equal(reloaded.audioVolume('effects'), 37);
});
