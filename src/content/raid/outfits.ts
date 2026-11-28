import published from './published-outfits.json' with { type: 'json' };

interface Outfit {
  group: string;
  skin: string;
  model: string;
  clips?: string[];
}

const manifests = import.meta.glob<Outfit[]>('./local-outfits.json', {
  eager: true,
  import: 'default',
});
const outfits = new Map<string, Outfit>(published.map((o) => [o.group + '/' + o.skin, o]));
for (const local of manifests['./local-outfits.json'] ?? []) {
  const key = local.group + '/' + local.skin;
  // Prefer the same published model used in a match. Extra local scenes are gallery-only.
  if (outfits.has(key)) continue;
  outfits.set(key, {
    ...local,
    model: './player-assets/' + local.model,
  });
}
export const raidOutfits = [...outfits.values()];
