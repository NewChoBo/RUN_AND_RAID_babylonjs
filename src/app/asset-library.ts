import { uiText } from '../content/locales/ui.ts';
import '../ui/styles/library.css';
import {
  createView,
  frameModel,
  LoadAssetContainerAsync,
} from '../platform/babylon/model-preview.ts';
import type { AssetContainer } from '@babylonjs/core';
type Entry = {
  id: string;
  path: string;
  group: string;
  kind: string;
  state: string;
  hierarchy?: string;
  nodes?: number;
  texture?: string;
  model?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  embeddedImages?: number;
  clips?: string[];
  missingBitmaps?: string[];
  materialMatches?: Record<string, string>;
};
const base = './player-assets/';
const el = <T extends HTMLElement>(id: string) => document.querySelector<T>('#' + id)!;
const group = el<HTMLSelectElement>('group'),
  entries = el<HTMLSelectElement>('entries'),
  filter = el<HTMLInputElement>('filter');
const picture = el<HTMLImageElement>('picture'),
  canvas = el<HTMLCanvasElement>('model'),
  download = el<HTMLAnchorElement>('download');
const status = el('status'),
  info = el('info');
let source: Entry[] = [],
  active: AssetContainer | undefined,
  generation = 0;
let view: ReturnType<typeof createView> | undefined;
async function choose() {
  const id = ++generation;
  active?.dispose();
  active = undefined;
  const item = source.find((r) => r.id === entries.value);
  canvas.hidden = picture.hidden = download.hidden = true;
  status.textContent = info.textContent = '';
  el('name').textContent = item?.path ?? uiText('noResults');
  if (!item) return;
  const image = item.texture ?? item.thumbnail;
  const showImage = () => {
    if (image) {
      picture.src = base + image;
      picture.hidden = false;
    }
  };
  const file = item.model ?? item.texture ?? item.hierarchy;
  if (file) {
    download.href = base + file;
    download.hidden = false;
    download.textContent = item.model
      ? uiText('downloadGlb')
      : item.hierarchy
        ? uiText('downloadBones')
        : uiText('downloadPng');
    download.download = file.split('/').at(-1)!;
  }
  if (!item.model || item.state === 'rig') {
    showImage();
    status.textContent = item.texture
      ? item.width + ' × ' + item.height + ' PNG'
      : item.hierarchy
        ? uiText('hierarchy', { count: item.nodes ?? 0 })
        : uiText('noMesh');
    return;
  }
  status.textContent = uiText('loading3d');
  canvas.hidden = false;
  try {
    const v = (view ??= createView(canvas, () => !canvas.hidden && !el('library').hidden));
    v.engine.resize();
    const model = await LoadAssetContainerAsync(base + item.model, v.scene);
    if (id !== generation) {
      model.dispose();
      return;
    }
    active = model;
    model.addAllToScene();
    frameModel(v, model);
    status.textContent = item.clips?.length
      ? uiText('clipCount', { count: item.clips.length })
      : uiText('staticModel');
    if (model.animationGroups[0]) model.animationGroups[0].start(true);
    const details = [
      item.kind === 'motion' && !item.clips?.length ? uiText('singlePose') : '',
      Object.values(item.materialMatches ?? {}).some((reason) => reason.startsWith('skin-name'))
        ? uiText('matchedTextures')
        : '',
      item.embeddedImages === 0 ? uiText('noTextures') : '',
      item.missingBitmaps?.length
        ? uiText('missingFiles', { count: item.missingBitmaps.length })
        : '',
    ];
    info.textContent = details.filter(Boolean).join(' · ');
  } catch {
    if (id !== generation) return;
    canvas.hidden = true;
    showImage();
    status.textContent = uiText('previewError');
  }
}
function list() {
  const term = filter.value.trim().toLowerCase();
  const rows = source.filter(
    (r) => (!group.value || r.group === group.value) && r.path.toLowerCase().includes(term),
  );
  entries.replaceChildren(...rows.map((r) => new Option(r.path.slice(r.group.length + 1), r.id)));
  const preferred = rows.find((r) => r.path.toLowerCase() === 'hammer/hammer#default.max');
  if (rows.length) entries.value = preferred?.id ?? rows[0]!.id;
  el('count').textContent = rows.length + ' / ' + source.length;
  void choose();
}
async function start() {
  const data = await fetch(base + 'catalog.json');
  if (!data.ok) throw Error('catalog');
  const payload = await data.json();
  if (payload.version !== 1 || !Array.isArray(payload.files)) throw Error('catalog version');
  source = payload.files;
  group.add(new Option(uiText('all'), ''));
  for (const key of [...new Set(source.map((r) => r.group))].sort())
    group.add(new Option(key, key));
  group.addEventListener('change', list);
  filter.addEventListener('input', list);
  entries.addEventListener('change', () => void choose());
  list();
  group.disabled = filter.disabled = entries.disabled = false;
}
void start().catch(() => {
  el('name').textContent = uiText('prepareAssets');
  status.textContent = uiText('assetInstructions');
  canvas.hidden = true;
});
