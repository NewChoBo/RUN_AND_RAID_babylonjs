import published from './published-outfits.json' with { type: 'json' };

interface Outfit {
  group: string;
  skin: string;
  model: string;
}

const manifests = import.meta.glob<Outfit[]>('./local-outfits.json', {
  eager: true,
  import: 'default',
});
const outfits = new Map(published.map((o) => [o.group + '/' + o.skin, o]));
for (const local of manifests['./local-outfits.json'] ?? []) {
  outfits.set(local.group + '/' + local.skin, {
    ...local,
    model: './player-assets/' + local.model,
  });
}
export const raidOutfits = [...outfits.values()];
