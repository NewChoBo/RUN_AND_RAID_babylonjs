import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import outfits from '../../src/content/raid/published-outfits.json' with { type: 'json' };

test('each published Player outfit embeds the advertised clips and renders its body opaque', () => {
  for (const outfit of outfits) {
    const data = readFileSync(new URL('../../public/' + outfit.model, import.meta.url));
    const id = createHash('sha256').update(data).digest('hex').slice(0, 20);
    assert.equal(outfit.model, './assets/fighters/' + id + '.glb');
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
