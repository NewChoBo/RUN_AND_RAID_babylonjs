import { MeshBuilder, Quaternion, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { daggerSpeed } from '../../../content/raid/heroes/swift.ts';
import type { TrackingDagger } from '../../../game/raid/heroes/swift.ts';
import { RAID_HZ, WAGON } from '../../../game/raid/raid-rules.ts';
import { raidRunnerHeight, raidRunnerPositionAfter } from '../../../game/raid/runner-motion.ts';
import type { RaidView } from '../../../game/raid/raid-view.ts';
import { raidMaterial } from './raid-material.ts';

export function createSwiftDaggerFx(scene: Scene) {
  const steel = raidMaterial(scene, 'Swift dagger steel', '#eedbff', 0.65);
  const hilt = raidMaterial(scene, 'Swift dagger hilt', '#9a5788', 0.3);
  const up = Vector3.Up();
  const launchOffsets = new WeakMap<TrackingDagger, Vector3>();
  const daggers: TransformNode[] = [];
  function createDagger() {
    const root = new TransformNode('Swift tracking dagger', scene);
    const blade = MeshBuilder.CreateCylinder(
      'Swift dagger blade',
      { height: 0.56, diameterTop: 0, diameterBottom: 0.16, tessellation: 4 },
      scene,
    );
    blade.scaling.z = 0.4;
    blade.material = steel;
    const grip = MeshBuilder.CreateCylinder(
      'Swift dagger grip',
      { height: 0.17, diameter: 0.08, tessellation: 6 },
      scene,
    );
    grip.position.y = -0.36;
    grip.material = hilt;
    const guard = MeshBuilder.CreateBox(
      'Swift dagger guard',
      { width: 0.24, height: 0.045, depth: 0.07 },
      scene,
    );
    guard.position.y = -0.27;
    guard.material = hilt;
    for (const part of [blade, grip, guard]) {
      part.parent = root;
      part.isPickable = false;
    }
    root.rotationQuaternion = Quaternion.Identity();
    return root;
  }
  return (view: RaidView, subtick: number) => {
    let count = 0;
    for (const runner of view.runners) {
      const shot = runner.heroView.trackingDagger;
      if (!shot || view.tick < shot.releaseTick || runner.respawn) continue;
      const target = shot.target === 'wagon' ? undefined : view.runners[shot.target];
      if (target?.respawn) continue;
      const end = target ? raidRunnerPositionAfter(target, subtick) : WAGON;
      const to = new Vector3(end.x, target ? raidRunnerHeight(target, subtick) + 1 : 1.8, end.z);
      const root = (daggers[count] ??= createDagger());
      count++;
      root.setEnabled(true);
      root.position.set(shot.x, shot.height, shot.z);
      const direction = to.subtract(root.position);
      const gap = direction.length();
      const fraction = gap ? Math.min(1, (subtick * daggerSpeed) / (RAID_HZ * gap)) : 1;
      root.position.addInPlace(direction.scale(fraction));
      // Blend the animated hand into the authoritative flight path over the first two ticks.
      const age = view.tick + subtick - shot.releaseTick;
      if (age < 2) {
        let offset = launchOffsets.get(shot);
        if (!offset && view.tick === shot.releaseTick) {
          const hand = scene
            .getTransformNodeByName(runner.hero + ' facing')
            ?.getDescendants(false, (node) => /^Bip\d+ L Hand(?:\.\d+)?$/i.test(node.name))[0];
          if (hand instanceof TransformNode) {
            offset = hand
              .computeWorldMatrix(true)
              .getTranslation()
              .subtract(new Vector3(shot.x, shot.height, shot.z));
            launchOffsets.set(shot, offset);
          }
        }
        if (offset) root.position.addInPlace(offset.scale((1 - age / 2) * (1 - fraction)));
      }
      const heading = to.subtract(root.position);
      if (heading.lengthSquared() > 1e-8)
        Quaternion.FromUnitVectorsToRef(up, heading.normalize(), root.rotationQuaternion!);
    }
    for (let i = count; i < daggers.length; i++) daggers[i]!.setEnabled(false);
  };
}
