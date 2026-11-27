import { characterName, illustrations } from '../content/raid/gallery.ts';
import outfits from '../content/raid/published-outfits.json' with { type: 'json' };
import type { AssetContainer } from '@babylonjs/core';
import type { createView } from '../platform/babylon/model-preview.ts';
const root = document.querySelector<HTMLElement>('#shop-gallery')!;
const hero = root.querySelector<HTMLSelectElement>('#gallery-hero')!;
const items = root.querySelector<HTMLSelectElement>('#gallery-item')!;
const image = root.querySelector<HTMLImageElement>('img')!;
const canvas = root.querySelector('canvas')!;
const caption = root.querySelector('strong')!;
const status = root.querySelector<HTMLElement>('[role=status]')!;
const art = illustrations.map((i) => ({ group: i.hero, title: i.caption, url: i.image }));
const models = outfits.map((o) => ({
  group: characterName(o.group),
  title: o.skin === 'default' ? '기본' : o.skin,
  url: o.model,
}));
let catalog = art;
let request = 0;
let model: AssetContainer | undefined;
let view: ReturnType<typeof createView> | undefined;
async function select() {
  const id = ++request;
  const item = catalog.find((i) => i.url === items.value);
  model?.dispose();
  model = undefined;
  if (!item) return;
  caption.textContent = catalog === art ? item.title : item.group + ' · ' + item.title;
  canvas.hidden = catalog === art;
  image.hidden = !canvas.hidden;
  if (catalog === art) {
    status.textContent = '';
    image.alt = item.title;
    image.src = item.url;
    return;
  }
  status.textContent = '모델 불러오는 중…';
  try {
    const { createView, frameModel, LoadAssetContainerAsync } =
      await import('../platform/babylon/model-preview.ts');
    if (id !== request) return;
    const v = (view ??= createView(canvas, () => !root.hidden && !canvas.hidden));
    v.engine.resize();
    const loaded = await LoadAssetContainerAsync(item.url, v.scene);
    if (id !== request) {
      loaded.dispose();
      return;
    }
    model = loaded;
    model.addAllToScene();
    frameModel(v, model);
    status.textContent = '드래그로 회전 · 휠 또는 두 손가락으로 확대';
  } catch {
    if (id === request) status.textContent = '모델을 불러올 수 없습니다.';
  }
}
image.onerror = () => {
  if (catalog === art) status.textContent = '일러스트를 불러올 수 없습니다.';
};
function list() {
  const rows = catalog.filter((i) => i.group === hero.value);
  items.replaceChildren(...rows.map((i) => new Option(i.title, i.url)));
  items.value = (rows.find((i) => i.title === '기본') ?? rows[0])!.url;
  void select();
}
function mode(next: typeof catalog) {
  const previous = hero.value;
  catalog = next;
  const groups = [...new Set(catalog.map((i) => i.group))];
  hero.replaceChildren(...groups.map((g) => new Option(g, g)));
  hero.value = groups.includes(previous) ? previous : '해머';
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
    b.setAttribute('aria-pressed', String((b.dataset.mode === 'art') === (catalog === art)));
  list();
}
hero.onchange = list;
items.onchange = () => void select();
for (const b of root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
  b.onclick = () => mode(b.dataset.mode === 'art' ? art : models);
mode(art);
