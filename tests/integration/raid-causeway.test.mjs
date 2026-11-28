import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine, Scene, VertexBuffer } from '@babylonjs/core';
import { RAID_HZ, ROUND_TICKS } from '../../src/game/raid/raid-rules.ts';
import { RAID_FRONT_Z, RAID_REAR_Z, raidRoadTravel } from '../../src/game/raid/runner-motion.ts';
import { createRaidCauseway } from '../../src/platform/babylon/raid/raid-causeway.ts';

// Above the parapet, each cluster of masonry vertices belongs to one tall roadside pillar.
function pillarCentres(mesh, side) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const depths = [];
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] > 5 && Math.sign(positions[i]) === side) depths.push(positions[i + 2]);
  }
  depths.sort((a, b) => a - b);
  const clusters = [];
  for (const z of depths) {
    const last = clusters.at(-1);
    if (last && z - last.end < 6) last.end = z;
    else clusters.push({ start: z, end: z });
  }
  return clusters.map(({ start, end }) => (start + end) / 2);
}

test('roadside pillar pairs stay on the paving as runners walk, run and cross recycled spans', (t) => {
  const engine = new NullEngine();
  t.after(() => engine.dispose());
  // Only the waterfall texture needs a canvas. Geometry and instances use the real scene.
  engine.createCanvas = () => ({
    getContext: () => ({
      getImageData: (_x, _y, width, height) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData() {},
    }),
  });
  const scene = new Scene(engine);
  const causeway = createRaidCauseway(scene);
  const rails = scene.getMeshByName('moulded stone parapets');
  const local = pillarCentres(rails, 1);
  assert.equal(local.length, 3);
  assert.deepEqual(pillarCentres(rails, -1), local);

  const sections = [rails, ...rails.instances];
  function stations(runnerZ, tick) {
    causeway.update(runnerZ, tick);
    return sections
      .flatMap((mesh) => {
        const centre = mesh.computeWorldMatrix(true).getTranslation().z;
        return local.map((z) => z + centre);
      })
      .sort((a, b) => a - b);
  }
  let runnerZ = 0;
  const initial = stations(runnerZ, 0);
  assert.deepEqual(stations(runnerZ, 0), initial);
  const spacing = 24;
  // Follow the same sequence of physical pillars from just behind the runner to the far approach.
  const near = -8;
  const far = 80;
  for (let tick = RAID_HZ / 2; tick <= ROUND_TICKS; tick += RAID_HZ / 2) {
    const speed = Math.floor(tick / (RAID_HZ * 20)) % 2 === 0 ? 2.8 : -4.2;
    runnerZ = Math.max(RAID_REAR_Z, Math.min(RAID_FRONT_Z, runnerZ + speed * 0.5));
    const actual = stations(runnerZ, tick).filter((z) => z >= runnerZ + near && z <= runnerZ + far);
    const anchor = initial[0] - raidRoadTravel(tick);
    const first = Math.ceil((runnerZ + near - anchor) / spacing);
    const expected = [];
    for (let z = anchor + first * spacing; z <= runnerZ + far; z += spacing) expected.push(z);
    assert.deepEqual(actual, expected, 'roadside pillar positions at tick ' + tick);
  }
});
