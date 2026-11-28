import { uiText } from '../content/locales/ui.ts';
import { characterLabel, characterName, illustrations } from '../content/raid/gallery.ts';
import { getLocale } from '../content/locales/locale.ts';
import { outfitCatalog, outfitName } from '../content/raid/battle-outfits.ts';
import { raidOutfits } from '../content/raid/outfits.ts';
import type { AssetContainer } from '@babylonjs/core';
import type { createView } from '../platform/babylon/model-preview.ts';
import { choiceCard, touchPicker } from '../ui/touch-picker.ts';
const root = document.querySelector<HTMLElement>('#shop-gallery')!;
const hero = root.querySelector<HTMLButtonElement>('#gallery-hero')!;
const items = root.querySelector<HTMLElement>('#gallery-item')!;
let currentHero = '해머';
const picker = touchPicker(hero, uiText('character'), (value) => {
  currentHero = value;
  list();
});
window.addEventListener('hashchange', () => {
  if (location.hash !== '#/shop') picker.close();
});
const image = root.querySelector<HTMLImageElement>('img')!;
const canvas = root.querySelector('canvas')!;
const caption = root.querySelector('strong')!;
const status = root.querySelector<HTMLElement>('[role=status]')!;
interface GalleryItem {
  group: string;
  title: string;
  url: string;
  isDefault: boolean;
  outfitId?: string;
  playable: boolean;
}
const art: GalleryItem[] = illustrations.flatMap<GalleryItem>((i) => {
  const pairs = outfitCatalog.filter((o) => o.skinInfo?.art === i.caption);
  if (!pairs.length)
    return [{ group: i.hero, title: i.caption, url: i.image, isDefault: false, playable: false }];
  return pairs.map((o) => ({
    group: characterName(o.group),
    title: outfitName(o, getLocale()),
    url: i.image,
    isDefault: o.skin === 'default',
    outfitId: o.id,
    playable: o.playable,
  }));
});
const models: GalleryItem[] = raidOutfits.map((o) => {
  const id = o.group + '/' + o.skin;
  const pair = outfitCatalog.find((item) => item.id === id);
  return {
    group: characterName(o.group),
    title: pair ? outfitName(pair, getLocale()) : o.skin,
    url: o.model,
    isDefault: o.skin === 'default',
    outfitId: id,
    playable: !!pair?.playable,
  };
});
let catalog = art;
let currentItem: GalleryItem | undefined;
let request = 0;
let model: AssetContainer | undefined;
let view: ReturnType<typeof createView> | undefined;
async function select(item: GalleryItem) {
  currentItem = item;
  const id = ++request;
  model?.dispose();
  model = undefined;
  for (const b of items.querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(b.value === item.url));
  caption.textContent =
    catalog === art ? item.title : characterLabel(item.group) + ' · ' + item.title;
  if (!item.playable) caption.textContent += ' · ' + uiText('galleryOnly');
  caption.lang = catalog === art && !item.outfitId ? 'ko' : document.documentElement.lang;
  canvas.hidden = catalog === art;
  image.hidden = !canvas.hidden;
  if (catalog === art) {
    status.textContent = '';
    image.lang = 'ko';
    image.alt = item.title;
    image.src = item.url;
    return;
  }
  status.textContent = uiText('modelLoading');
  try {
    const { createView, frameModel, LoadAssetContainerAsync } =
      await import('../platform/babylon/model-preview.ts');
    if (id !== request) return;
    const v = (view ??= createView(canvas, () => !root.hidden && !canvas.hidden));
    v.engine.resize();
    const loaded = await LoadAssetContainerAsync(item.url, v.scene, {
      pluginOptions: { gltf: { animationStartMode: 0 } },
    });
    if (id !== request) {
      loaded.dispose();
      return;
    }
    model = loaded;
    model.addAllToScene();
    frameModel(v, model);
    const preview =
      model.animationGroups.find((group) => group.name === 'run') ?? model.animationGroups[0];
    preview?.start(true);
    status.textContent = uiText('modelControls');
  } catch {
    if (id === request) status.textContent = uiText('modelError');
  }
}
image.onerror = () => {
  if (catalog === art) status.textContent = uiText('artError');
};
function list(outfitId?: string) {
  const rows = catalog.filter((i) => i.group === currentHero);
  items.replaceChildren(
    ...rows.map((i) => {
      const card = choiceCard(
        { label: i.title, value: i.url, image: catalog === art ? i.url : undefined },
        false,
        () => void select(i),
      );
      card.value = i.url;
      if (catalog === art && !i.outfitId) card.lang = 'ko';
      return card;
    }),
  );
  items.scrollTop = 0;
  const selected =
    (outfitId && rows.find((i) => i.outfitId === outfitId)) ||
    rows.find((i) => i.isDefault) ||
    rows[0];
  if (selected) void select(selected);
}
function mode(next: typeof catalog) {
  catalog = next;
  const groups = [...new Set(catalog.map((i) => i.group))];
  if (!groups.includes(currentHero)) currentHero = '해머';
  picker.set(
    groups.map((g) => ({
      label: characterLabel(g),
      value: g,
      image: art.find((i) => i.group === g)?.url,
    })),
    currentHero,
  );
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    b.setAttribute('aria-pressed', String((b.dataset.mode === 'art') === (catalog === art)));
  list(currentItem?.outfitId);
}
for (const b of root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
  b.onclick = () => mode(b.dataset.mode === 'art' ? art : models);
mode(art);
