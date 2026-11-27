import { EngineStore, LoadAssetContainerAsync } from '@babylonjs/core';

// Run from the browser console after starting a local Vite practice match.
export async function previewStaticHero(hero, sourcePath) {
  const scene = EngineStore.LastCreatedScene;
  const rig = scene?.getTransformNodeByName(hero + ' facing');
  if (!rig?.getChildMeshes().length) throw Error('먼저 해당 영웅으로 봇 경기를 시작하세요.');
  const catalog = await (await fetch('/player-assets/catalog.json')).json();
  const entry = catalog.files.find((file) => file.path === sourcePath && file.group === hero);
  if (entry?.state !== 'static' || !entry.model) throw Error('해당 영웅의 정적 GLB가 필요합니다.');
  const model = await LoadAssetContainerAsync('/player-assets/' + entry.model, scene);
  const original = rig.getChildren();
  const root = model.meshes[0];
  model.addAllToScene();
  root.normalizeToUnitCube(true);
  root.scaling.scaleInPlace(2);
  root.position.y -= root.getHierarchyBoundingVectors().min.y;
  root.parent = rig;
  for (const child of original) child.setEnabled(false);
  return {
    camera: scene.activeCamera.name,
    meshes: root.getChildMeshes().map((mesh) => mesh.name),
  };
}
