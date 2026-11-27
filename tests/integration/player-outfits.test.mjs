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
    assert.deepEqual(
      (doc.animations ?? []).map((clip) => clip.name),
      outfit.clips,
      outfit.model,
    );
    for (const material of doc.materials ?? []) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE', outfit.model);
    }
    for (const resource of [...doc.buffers, ...(doc.images ?? [])]) {
      assert.equal(resource.uri, undefined, outfit.model);
    }
  }
});
