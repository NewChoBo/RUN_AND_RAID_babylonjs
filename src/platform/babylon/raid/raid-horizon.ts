import {
  Color3,
  MeshBuilder,
  RawTexture,
  type Scene,
  StandardMaterial,
  Texture,
  TransformNode,
} from '@babylonjs/core';

/** The mountain pass and its beacon stay beyond the moving causeway. */
export function createRaidHorizon(scene: Scene) {
  const horizon = new TransformNode('far end of the canyon', scene);
  const sky = new Texture('./assets/raid/environment/canyon-horizon.webp', scene);
  sky.wrapU = sky.wrapV = Texture.CLAMP_ADDRESSMODE;
  // Extend the outermost sky pixels past wide viewports without stretching the central valley.
  sky.uScale = 520 / 176;
  sky.uOffset = (1 - sky.uScale) / 2;
  sky.vScale = 140 / 63;
  sky.vOffset = (1 - sky.vScale) / 2;
  const mountains = new StandardMaterial('sunlit mountain pass', scene);
  mountains.disableLighting = true;
  mountains.fogEnabled = false;
  mountains.emissiveTexture = sky;
  const panorama = MeshBuilder.CreatePlane(
    'distant canyon walls',
    { width: 520, height: 140 },
    scene,
  );
  panorama.parent = horizon;
  panorama.position.set(0, 12, 97);
  panorama.material = mountains;
  panorama.isPickable = false;

  // A steady shaft of daylight behind the gate has softer edges than the boss's electric pillars.
  const profile = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i++) {
    const distance = Math.abs((2 * i) / 63 - 1);
    profile.set([255, 255, 255, Math.round(160 * (1 - distance) ** 1.8)], i * 4);
  }
  const light = RawTexture.CreateRGBATexture(
    profile,
    64,
    1,
    scene,
    false,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  light.hasAlpha = true;
  light.wrapU = Texture.CLAMP_ADDRESSMODE;
  const beacon = new StandardMaterial('gate beacon', scene);
  beacon.diffuseTexture = light;
  beacon.useAlphaFromDiffuseTexture = true;
  beacon.emissiveColor = new Color3(0.76, 0.93, 1);
  beacon.disableLighting = true;
  beacon.fogEnabled = false;
  const shaft = MeshBuilder.CreatePlane(
    'light over the stone gate',
    { width: 3, height: 80 },
    scene,
  );
  shaft.parent = horizon;
  shaft.position.set(0, 40, 78);
  shaft.material = beacon;
  shaft.isPickable = false;
  return horizon;
}
