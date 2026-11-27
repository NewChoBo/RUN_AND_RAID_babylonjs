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

export { LoadAssetContainerAsync };
export function createView(canvas: HTMLCanvasElement, visible: () => boolean) {
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
    if (visible()) scene.render();
  });
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) {
      resize.disconnect();
      engine.dispose();
    }
  });
  return { engine, scene, camera };
}
export function frameModel(v: ReturnType<typeof createView>, model: AssetContainer) {
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
}
