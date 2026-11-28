import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WAGON_BODY,
  wagonCenter,
  wagonContact,
  wagonProjectileContact,
  wagonSectorContact,
  wagonSegmentContact,
} from '../../src/game/raid/wagon.ts';
import { RAID_HZ, RAID_ROAD_WIDTH, ROUND_TICKS } from '../../src/game/raid/raid-rules.ts';

test('wagon moves to both sides of the road with the entire hull on the paving', () => {
  const positions = Array.from({ length: ROUND_TICKS / RAID_HZ }, (_, s) =>
    wagonCenter(s * RAID_HZ),
  );
  assert.equal(positions[0].x, 0);
  assert.ok(positions.some(({ x }) => x < -1));
  assert.ok(positions.some(({ x }) => x > 1));
  for (const { x, z } of positions) {
    assert.ok(Math.abs(x) + WAGON_BODY.halfWidth < RAID_ROAD_WIDTH / 2);
    assert.equal(z, positions[0].z);
  }
});

test('a runner at the flank can reach part of the body inside their forward sector', () => {
  const tick = 0;
  const center = wagonCenter(tick);
  const from = { x: center.x + WAGON_BODY.halfWidth + 1, z: center.z - 1 };
  const side = wagonContact(from, tick);
  assert.deepEqual(side, { x: center.x + WAGON_BODY.halfWidth, z: from.z });
  const visible = wagonSectorContact(from, tick, Math.PI / 4);
  assert.ok(visible);
  assert.equal(visible.x, side.x);
  assert.ok(Math.abs(visible.z - from.z - 1) < 1e-9);
  assert.equal(wagonSectorContact({ x: from.x + 10, z: from.z }, tick, Math.PI / 4), null);
});

test('side hits stop at the hull skin, rounded splash corners exclude nearby misses', () => {
  const { x, z } = wagonCenter(0);
  const edge = x + WAGON_BODY.halfWidth;
  assert.ok(Math.abs(wagonSegmentContact({ x: edge + 1, z }, { x: edge - 1, z }, 0) - 0.5) < 1e-9);
  const corner = { x: edge + 0.8, z: z + WAGON_BODY.halfDepth + 0.8 };
  assert.equal(wagonSegmentContact(corner, corner, 0, 1), null);
  const rear = z - WAGON_BODY.halfDepth;
  const entry = wagonSegmentContact(
    { x: edge + 0.6, z: rear - 2 },
    { x: edge + 0.6, z: rear },
    0,
    1,
  );
  assert.ok(Math.abs(entry - 0.6) < 1e-9);
});

test('a broad blade extends sideways while its leading edge and moving-target timing stay exact', () => {
  const { x, z } = wagonCenter(0);
  const rear = z - WAGON_BODY.halfDepth;
  const side = x + WAGON_BODY.halfWidth + 1;
  assert.equal(
    wagonProjectileContact({ x: side, z: rear - 2 }, { x: side, z: rear - 1 }, 0, 0, 1, 2),
    null,
  );
  assert.equal(
    wagonProjectileContact({ x: side, z: rear - 1 }, { x: side, z: rear + 1 }, 0, 0, 1, 2),
    0.5,
  );
  let tick = 1;
  while (tick < ROUND_TICKS && wagonCenter(tick).x - wagonCenter(tick - 1).x < 0.01) tick++;
  assert.ok(tick < ROUND_TICKS);
  const edgeHalfway = (wagonCenter(tick - 1).x + wagonCenter(tick).x) / 2 + WAGON_BODY.halfWidth;
  const point = { x: edgeHalfway, z };
  assert.ok(Math.abs(wagonSegmentContact(point, point, tick, 0, tick - 1) - 0.5) < 1e-9);
});
