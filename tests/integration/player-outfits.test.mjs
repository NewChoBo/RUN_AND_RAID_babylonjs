import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import outfits from '../../src/content/raid/published-outfits.json' with { type: 'json' };

test('each published Player outfit embeds the advertised clips and renders its body opaque', () => {
  const paths = new Set();
  const checksums = new Map(
    readFileSync(new URL('../../.github/pages-assets.sha256', import.meta.url), 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => [line.slice(66), line.slice(0, 64)]),
  );
  for (const outfit of outfits) {
    const skin = outfit.skin.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const path = `assets/fighters/${outfit.group}-${skin}.glb`;
    assert.equal(outfit.model, './' + path);
    assert.ok(!paths.has(path), path);
    paths.add(path);
    const data = readFileSync(new URL('../../public/' + outfit.model, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), checksums.get(path), path);
    const doc = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
    assert.ok(doc.meshes?.length, outfit.model);
    if (outfit.group === 'magnus' && outfit.skin === 'armoredforces') {
      // The equipped shields live on the body rig. Loose copies from the workshop
      // used to render next to the runner and inflate its loading bounds.
      const meshNodes = doc.nodes.filter((node) => node.mesh !== undefined);
      assert.ok(
        meshNodes.every((node) => node.skin !== undefined),
        outfit.model,
      );
      const joints = doc.skins[meshNodes[0].skin].joints.map((index) => doc.nodes[index].name);
      for (const bone of ['ShieldboneL001', 'ShieldboneR001']) assert.ok(joints.includes(bone));
    }
    assert.deepEqual(
      (doc.animations ?? []).map((clip) => clip.name),
      outfit.clips,
      outfit.model,
    );
    if (outfit.clips.includes('run')) {
      for (const clip of doc.animations) {
        const { seconds, takes } = clip.extras.sourceTiming;
        const duration = takes.reduce(
          (sum, t) => sum + (t.endTick - t.startTick) / (t.ticksPerFrame * t.fps),
          0,
        );
        const inputs = clip.samplers.map((s) => doc.accessors[s.input]);
        const actual =
          Math.max(...inputs.map((a) => a.max[0])) - Math.min(...inputs.map((a) => a.min[0]));
        assert.ok(duration > 0 && Math.abs(seconds - duration) < 1e-6, path);
        assert.ok(Math.abs(actual - duration) < 1e-4, path + '/' + clip.name);
      }
    }
    for (const material of doc.materials ?? []) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE', outfit.model);
    }
    for (const resource of [...doc.buffers, ...(doc.images ?? [])]) {
      assert.equal(resource.uri, undefined, outfit.model);
    }
  }
});
