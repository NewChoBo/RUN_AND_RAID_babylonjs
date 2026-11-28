import assert from 'node:assert/strict';
import test from 'node:test';
import { RaidMatch } from '../../src/game/raid/raid-match.ts';
import { healthMeter, healthMeterPainter } from '../../src/ui/raid-health-meter.ts';

test('HUD and overhead bars track remaining absorption, expiry, guard and respawn independently of HP', () => {
  const runner = new RaidMatch(['magnus', 'jade', 'swift', 'rildin']).runners[0];
  const protectedRunner = {
    ...runner,
    barrier: { amount: 10, until: 13 },
    shield: 1,
    heroView: { guardUntil: 12 },
  };
  const full = { hp: 155, max: 155, barrier: 10, reducedDamage: true, guarding: true };
  assert.deepEqual(healthMeter(protectedRunner, 11), full);
  assert.deepEqual(healthMeter({ ...protectedRunner, barrier: { amount: 4, until: 13 } }, 12), {
    ...full,
    barrier: 4,
    guarding: false,
  });
  assert.deepEqual(healthMeter({ ...protectedRunner, hp: 80, shield: 0 }, 13), {
    ...full,
    hp: 80,
    barrier: 0,
    guarding: false,
    reducedDamage: false,
  });
  assert.deepEqual(healthMeter({ ...protectedRunner, respawn: 3 }, 11), {
    ...full,
    hp: 0,
    barrier: 0,
    guarding: false,
    reducedDamage: false,
  });
});

test('155 HP has six 25 HP divisions and a short final cell, with a separate shield even at full HP', () => {
  const rects = [];
  const context = {
    fillStyle: '',
    clearRect() {
      rects.length = 0;
    },
    fillRect(x, y, w, h) {
      rects.push({ color: this.fillStyle, x, y, w, h });
    },
  };
  const paint = healthMeterPainter(context, 159, 32);
  const full = { hp: 155, max: 155, barrier: 10, reducedDamage: false, guarding: false };
  assert.ok(paint(full, true));
  const dividers = rects.filter((r) => r.color.startsWith('rgba'));
  assert.deepEqual(
    dividers.map((r) => r.x - 2),
    [25, 50, 75, 100, 125, 150],
  );
  const hp = rects.find((r) => r.color === '#8fd34d');
  const shield = rects.find((r) => r.color === '#77ecf3');
  assert.equal(hp.w, 155);
  assert.equal(shield.w, 10);
  assert.ok(shield.y + shield.h <= hp.y);
  assert.equal(paint({ ...full }, true), false);
  assert.ok(paint({ ...full, hp: 33, barrier: 0, reducedDamage: true, guarding: true }, false));
  assert.equal(rects.find((r) => r.color === '#ed644d').w, 33);
  assert.ok(!rects.some((r) => r.color === '#77ecf3'));
  assert.notEqual(
    rects.find((r) => r.color === '#f9cb73').y,
    rects.find((r) => r.color === '#d3aeff').y,
  );
});
