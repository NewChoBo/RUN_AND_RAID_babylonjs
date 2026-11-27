interface Outfit {
  group: string;
  skin: string;
  model: string;
}

const manifests = import.meta.glob<Outfit[]>('./local-outfits.json', {
  eager: true,
  import: 'default',
});
export const localOutfits = manifests['./local-outfits.json'] ?? [];
