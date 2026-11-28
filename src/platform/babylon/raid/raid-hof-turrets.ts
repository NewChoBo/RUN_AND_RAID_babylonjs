import { ModelMotion } from '../actors/model-motion.ts';
import {
  LoadAssetContainerAsync,
  MeshBuilder,
  TransformNode,
  Vector3,
  type AssetContainer,
  type InstantiatedEntries,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { raidGroundPointAfter } from '../../../game/raid/runner-motion.ts';
import type { RaidView } from '../../../game/raid/raid-view.ts';
import { raidMaterial } from './raid-material.ts';

interface InstalledModel {
  root: TransformNode;
  beam: Mesh;
  instances?: InstantiatedEntries;
  motion?: ModelMotion;
}
const kinds = ['gun', 'ice', 'thunder'] as const;
export function createHofTurrets(scene: Scene) {
  const assets = new Map<string, Promise<AssetContainer>>();
  const live = new Map<string, InstalledModel>();
  const inks = ['#f5b54d', '#86deff', '#ae98ff'].map((color, i) =>
    raidMaterial(scene, 'Hof ' + kinds[i] + ' shot', color, 0.9),
  );
  const blasts: Mesh[] = [];
  let match: RaidView | undefined;
  function remove(key: string) {
    const item = live.get(key)!;
    item.instances?.dispose();
    item.root.dispose();
    item.beam.dispose();
    live.delete(key);
  }
  function spawn(key: string, skin: string, slot: 0 | 1 | 2) {
    const root = new TransformNode('Hof ' + kinds[slot] + ' installation', scene);
    const ring = MeshBuilder.CreateTorus(
      'Hof placement ring',
      { diameter: 1.08, thickness: 0.055, tessellation: 22 },
      scene,
    );
    ring.parent = root;
    ring.position.y = 0.05;
    ring.material = inks[slot]!;
    ring.isPickable = false;
    const beam = MeshBuilder.CreateCylinder(
      'Hof ' + kinds[slot] + ' tracer',
      { height: 1, diameter: slot === 1 ? 0.12 : 0.07, tessellation: 5 },
      scene,
    );
    beam.material = inks[slot]!;
    beam.isPickable = false;
    beam.setEnabled(false);
    const item: InstalledModel = { root, beam };
    live.set(key, item);
    const url = './assets/raid/turrets/hof-' + skin + '-' + kinds[slot] + '.glb';
    let load = assets.get(url);
    if (!load) {
      load = LoadAssetContainerAsync(url, scene, {
        pluginOptions: { gltf: { animationStartMode: 0 } },
      });
      assets.set(url, load);
      void load.catch(() => assets.delete(url));
    }
    void load
      .then((asset) => {
        if (scene.isDisposed || live.get(key) !== item) return;
        const model = asset.instantiateModelsToScene((name) =>
          ['spawn', 'attack', 'run'].includes(name) ? name : 'Hof ' + kinds[slot] + ' ' + name,
        );
        item.instances = model;
        item.motion = new ModelMotion(model.animationGroups, ['spawn', 'attack', 'run']);
        for (const node of model.rootNodes) {
          for (const mesh of node.getChildMeshes()) mesh.isPickable = false;
          node.parent = root;
        }
      })
      .catch((error) => {
        if (!scene.isDisposed) console.warn('Could not load Hof turret', url, error);
      });
    return item;
  }
  scene.onDisposeObservable.addOnce(() => {
    for (const asset of assets.values())
      void asset.then(
        (a) => a.dispose(),
        () => {},
      );
    assets.clear();
  });
  return (view: RaidView, subtick: number, outfits: readonly (string | undefined)[]) => {
    if (match !== view) {
      for (const key of live.keys()) remove(key);
      match = view;
    }
    const now = view.tick + subtick,
      visible = new Set<string>();
    let blastCount = 0;
    for (const r of view.runners) {
      const outfit = outfits[r.slot];
      const skin =
        outfit === 'hof/western' ? 'western' : outfit === 'hof/astronaut' ? 'astronaut' : 'default';
      for (const turret of r.heroView.turrets ?? []) {
        const key = [r.slot, turret.id, turret.placed, skin].join('/');
        visible.add(key);
        const { root, beam, motion } = live.get(key) ?? spawn(key, skin, turret.slot);
        const pos = turret;
        root.position.set(pos.x, 0, pos.z);
        const shot = turret.shot;
        if (now - turret.placed < 36) motion?.once('spawn', (now - turret.placed) / 30, 1);
        else if (shot && now - shot.tick < 25) motion?.once('attack', (now - shot.tick) / 30, 1);
        else motion?.loop('run', (now - turret.placed) / 30, 1);
        beam.setEnabled(!!shot && now - shot.tick < 4);
        if (!shot) continue;
        const target = shot;
        root.rotation.y = Math.atan2(target.x - pos.x, target.z - pos.z);
        if (!beam.isEnabled()) continue;
        const muzzle = new Vector3(pos.x, 0.55, pos.z),
          end = new Vector3(target.x, 0.85, target.z);
        const dir = end.subtract(muzzle);
        beam.position.copyFrom(muzzle.add(end).scale(0.5));
        beam.scaling.y = dir.length();
        beam.setDirection(dir, 0, Math.PI / 2);
      }
      for (const b of r.heroView.blasts ?? []) {
        const age = now - b.tick;
        if (age >= 12) continue;
        const ring = (blasts[blastCount] ??= MeshBuilder.CreateTorus(
          'Hof remote blast',
          { diameter: 2, thickness: 0.12, tessellation: 40 },
          scene,
        ));
        blastCount++;
        ring.setEnabled(true);
        ring.material = inks[0]!;
        ring.isPickable = false;
        const pos = raidGroundPointAfter(b, age);
        ring.position.set(pos.x, 0.12, pos.z);
        ring.scaling.setAll(0.4 + (5.6 * age) / 12);
      }
    }
    for (const key of live.keys()) if (!visible.has(key)) remove(key);
    for (const b of blasts.slice(blastCount)) b.setEnabled(false);
  };
}
