import { Mesh, Quaternion, TransformNode, Vector3, type Scene } from '@babylonjs/core';
import { airArrowFlight } from '../../../content/raid/heroes/longshot.ts';
import type { AirArrow } from '../../../game/raid/heroes/hero-definition.ts';
import type { RaidView } from '../../../game/raid/raid-view.ts';
import { raidGroundPointAfter } from '../../../game/raid/runner-motion.ts';
import { createRaidArrow } from './raid-arrow.ts';
import { raidMaterial } from './raid-material.ts';

export function createAirArrows(scene: Scene) {
  const ink = raidMaterial(scene, 'Longshot falling arrow', '#ffe5a3', 0.8);
  const launch = new WeakMap<AirArrow, Vector3>();
  const arrows: Mesh[] = [];
  const down = Vector3.Down();
  let source: Mesh | undefined;
  return (view: RaidView, subtick: number) => {
    let count = 0;
    for (const r of view.runners) {
      for (const shot of r.heroView.airArrows ?? []) {
        const age = view.tick + subtick - shot.tick;
        if (age >= airArrowFlight) continue;
        let from = launch.get(shot);
        if (!from) {
          // Sample the animated bow once. A late frame can still draw from the simulation sample.
          const bow =
            age < 1 &&
            scene
              .getTransformNodeByName(r.hero + ' facing')
              ?.getDescendants(false, (n) => n.name === 'Bowbone')[0];
          from =
            bow instanceof TransformNode
              ? bow.computeWorldMatrix(true).getTranslation()
              : new Vector3(shot.x, shot.height, shot.z);
          launch.set(shot, from);
        }
        source ??= createRaidArrow(scene);
        const arrow = (arrows[count] ??= source.clone('Longshot descending arrow'));
        count++;
        arrow.setEnabled(true);
        arrow.material = ink;
        const ground = raidGroundPointAfter(shot, airArrowFlight);
        const end = new Vector3(ground.x, 0.06, ground.z);
        Vector3.LerpToRef(from, end, age / airArrowFlight, arrow.position);
        Quaternion.FromUnitVectorsToRef(
          down,
          end.subtract(from).normalize(),
          (arrow.rotationQuaternion ??= Quaternion.Identity()),
        );
      }
    }
    for (let i = count; i < arrows.length; i++) arrows[i]!.setEnabled(false);
  };
}
