import '../ui/styles/library.css';
import {
  Engine,
  Scene,
  ArcRotateCamera,
  Color4,
  HemisphericLight,
  Vector3,
  LoadAssetContainerAsync,
} from '@babylonjs/core';
import type { AssetContainer } from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';

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
function createView() {
  const engine = new Engine(canvas, true, { stencil: true });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0.14, 0.19, 0.23, 1);
  const camera = new ArcRotateCamera('orbit', 1.1, 1.3, 4, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  new HemisphericLight('light', new Vector3(0.3, 1, 0.5), scene).intensity = 1.2;
  const resize = new ResizeObserver(() => engine.resize());
  resize.observe(canvas);
  engine.runRenderLoop(() => {
    if (!canvas.hidden && !el('library').hidden) scene.render();
  });
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) {
      resize.disconnect();
      engine.dispose();
    }
  });
  return { engine, scene, camera };
}
async function choose() {
  const id = ++generation;
  active?.dispose();
  active = undefined;
  const item = source.find((r) => r.id === entries.value);
  canvas.hidden = picture.hidden = download.hidden = true;
  status.textContent = info.textContent = '';
  el('name').textContent = item?.path ?? '검색 결과 없음';
  if (!item) return;
  const image = item.texture ?? item.thumbnail;
  const showImage = () => {
    if (image) {
      picture.src = base + image;
      picture.hidden = false;
    }
  };
  if (item.model || item.texture || item.hierarchy) {
    download.href = base + (item.model ?? item.texture ?? item.hierarchy);
    download.hidden = false;
    download.textContent = item.model
      ? 'GLB 다운로드'
      : item.hierarchy
        ? '본 계층 JSON 다운로드'
        : 'PNG 다운로드';
    download.download = (item.path.split('/').pop() ?? item.id).replace(
      /\.[^.]+$/,
      item.model ? '.glb' : item.hierarchy ? '.json' : '.png',
    );
  }
  if (!item.model) {
    showImage();
    status.textContent = item.texture
      ? item.width + ' × ' + item.height + ' PNG'
      : item.hierarchy
        ? '원본 본·헬퍼 계층 · 노드 ' + item.nodes + '개 (포즈·가중치 미포함)'
        : '원본 MAX 장면 · 변환된 메시 없음';
    return;
  }
  status.textContent = '3D 모델 불러오는 중…';
  canvas.hidden = false;
  try {
    const v = (view ??= createView());
    v.engine.resize();
    const model = await LoadAssetContainerAsync(base + item.model, v.scene);
    if (id !== generation) {
      model.dispose();
      return;
    }
    active = model;
    model.addAllToScene();
    let lo = new Vector3(Infinity, Infinity, Infinity),
      hi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of model.meshes) {
      if (!mesh.getTotalVertices()) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      lo = Vector3.Minimize(lo, box.minimumWorld);
      hi = Vector3.Maximize(hi, box.maximumWorld);
    }
    const span = Vector3.Distance(lo, hi);
    if (Number.isFinite(span) && span > 0) {
      v.camera.target = lo.add(hi).scale(0.5);
      v.camera.radius = span * 1.5;
      v.camera.minZ = span / 1000;
      v.camera.maxZ = span * 100;
      v.camera.lowerRadiusLimit = span * 0.15;
      v.camera.upperRadiusLimit = span * 8;
      v.camera.wheelPrecision = 60 / span;
    }
    status.textContent = item.clips?.length
      ? '애니메이션 ' + item.clips.length + '개'
      : '정적 3D 모델';
    if (model.animationGroups[0]) model.animationGroups[0].start(true);
    const details = [
      item.kind === 'motion' && !item.clips?.length ? '모션 원본에서 가져온 한 자세입니다.' : '',
      Object.values(item.materialMatches ?? {}).some((reason) => reason.startsWith('skin-name'))
        ? '같은 영웅·스킨 이름으로 텍스처를 연결했습니다.'
        : '',
      item.embeddedImages === 0 ? '이 GLB에는 텍스처가 없습니다.' : '',
      item.missingBitmaps?.length
        ? '원본이 참조한 미동봉 파일 ' + item.missingBitmaps.length + '개'
        : '',
    ];
    info.textContent = details.filter(Boolean).join(' · ');
  } catch {
    if (id !== generation) return;
    canvas.hidden = true;
    showImage();
    status.textContent = '3D 미리보기를 열 수 없습니다. 아래에서 변환 파일을 받을 수 있습니다.';
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
  group.add(new Option('전체', ''));
  for (const key of [...new Set(source.map((r) => r.group))].sort())
    group.add(new Option(key, key));
  group.addEventListener('change', list);
  filter.addEventListener('input', list);
  entries.addEventListener('change', () => void choose());
  list();
}
void start().catch(() => {
  el('name').textContent = '원작 에셋을 준비해 주세요';
  status.textContent = 'README의 에셋 준비 명령으로 개발진 제공 ZIP을 연결할 수 있습니다.';
  canvas.hidden = true;
});
