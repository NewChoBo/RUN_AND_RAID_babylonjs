import { Color3, HemisphericLight, ImportMeshAsync, TransformNode, Vector3 } from '@babylonjs/core';
import { ModelMotion } from '../actors/model-motion.ts';
import { bindInkApparitionSurfaces } from './ink-apparition-surfaces.ts';

import type { BotAttackPose } from '../../../game/ai/bot-attack.ts';
import type { Scene } from '@babylonjs/core';

const path = './assets/chapter-art/';

export async function loadInkApparition(scene: Scene, parent: TransformNode) {
  const model = await ImportMeshAsync(path + 'ink-apparition.glb', scene, {
    pluginOptions: { gltf: { animationStartMode: 0 } },
  });
  model.meshes[0]!.parent = parent;
  const { head, surfaces } = bindInkApparitionSurfaces(model);

  const lanternFill = new HemisphericLight(
    'ink shadow cool fill',
    new Vector3(-0.42, 0.83, -0.36),
    scene,
  );
  lanternFill.diffuse = new Color3(0.7, 0.73, 0.82);
  lanternFill.groundColor = new Color3(0.28, 0.23, 0.17);
  lanternFill.intensity = 0.42;
  lanternFill.renderPriority = 17;
  lanternFill.includedOnlyMeshes = surfaces;

  const motion = new ModelMotion(model.animationGroups, [
    'Hover',
    'Glide',
    'Windup',
    'Recover',
    'Stagger',
  ]);
  let clock = 0;
  function pose(dt: number, stunned: boolean, speed: number, attack: BotAttackPose) {
    clock += dt;
    if (stunned) motion.loop('Stagger', clock, dt);
    else if (attack.phase === 'windup') motion.seek('Windup', attack.progress, dt);
    else if (attack.phase === 'recovery') motion.seek('Recover', attack.progress, dt, false);
    else motion.loop(speed > 0.035 ? 'Glide' : 'Hover', clock, dt);
  }
  motion.loop('Hover', 0, 0);
  return { head, pose };
}
