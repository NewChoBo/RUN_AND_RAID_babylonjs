import {
  Color3,
  Mesh,
  MeshBuilder,
  RawTexture,
  StandardMaterial,
  Texture,
  type Scene,
} from '@babylonjs/core';
import { RAID_HZ } from '../../../game/raid/raid-rules.ts';
import { wagonContact } from '../../../game/raid/wagon.ts';
import { raidRunnerHeight, raidRunnerPositionAfter } from '../../../game/raid/runner-motion.ts';
import type { RaidView } from '../../../game/raid/raid-view.ts';

export function createFlameMaterial(scene: Scene) {
  const size = 64;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const height = (y + 0.5) / size;
    // A broad ember bed narrows into an off-centre, curling tongue.
    const width = Math.sin(Math.PI * height) ** 0.47 * (1 - 0.78 * height);
    const bend = height * (0.23 * Math.sin(7 * height) + 0.16 * Math.sin(14 * height));
    for (let x = 0; x < size; x++) {
      const offset = (((x + 0.5) / size) * 2 - 1 - bend) / width;
      const heat = Math.max(0, 1 - offset * offset);
      const core = heat ** 2 * (1 - height);
      const i = (y * size + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 48 + 190 * core;
      pixels[i + 2] = 8 + 86 * core ** 2;
      pixels[i + 3] = 220 * heat * Math.min(1, height * 14, (1 - height) * 7);
    }
  }
  const texture = RawTexture.CreateRGBATexture(
    pixels,
    size,
    size,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.hasAlpha = true;
  const material = new StandardMaterial('Flare fire', scene);
  material.diffuseTexture = texture;
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveColor = Color3.White();
  material.disableLighting = material.disableDepthWrite = true;
  material.alpha = 0.78;
  return material;
}

export function createFlame(scene: Scene, name: string, material: StandardMaterial) {
  const mesh = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

/** The flames belong to the marked target and brighten on the scheduled damage tick. */
export function createIgnitionFx(scene: Scene, material: StandardMaterial) {
  const pool: Mesh[][] = [];
  function cluster() {
    return Array.from({ length: 5 }, () => createFlame(scene, 'ignite flame', material));
  }
  return (view: RaidView, subtick: number) => {
    let used = 0;
    for (const caster of view.runners) {
      for (const burn of caster.heroView.burns ?? []) {
        const target = burn.target === 'wagon' ? undefined : view.runners[burn.target];
        if (target?.respawn) continue;
        const center = target
          ? raidRunnerPositionAfter(target, subtick)
          : wagonContact(caster, view.tick + subtick);
        const floor = target ? raidRunnerHeight(target) : 1.4;
        const age = view.tick + subtick - (burn.next - RAID_HZ);
        const pulse = Math.exp(-Math.max(0, age) / 5);
        const flames = (pool[used] ??= cluster());
        used++;
        for (const [i, mesh] of flames.entries()) {
          const phase = (age / 20 + i / flames.length) % 1;
          const a = i * 2.4 + age * 0.06;
          const size = 0.55 + 0.5 * Math.sin(Math.PI * phase) + pulse * 0.6;
          mesh.position.set(
            center.x + 0.38 * Math.cos(a),
            floor + 0.5 + phase * 0.6,
            center.z + 0.38 * Math.sin(a),
          );
          mesh.scaling.set(size * 0.77, size * 1.1, 1);
          mesh.rotation.z = 0.22 * Math.sin(a);
          mesh.setEnabled(true);
        }
      }
    }
    for (let i = used; i < pool.length; i++) for (const mesh of pool[i]!) mesh.setEnabled(false);
  };
}
