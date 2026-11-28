import { Color3, Mesh, MeshBuilder, StandardMaterial, Texture, type Scene } from '@babylonjs/core';
import { wagonCenter } from '../../../game/raid/wagon.ts';
import type { RaidPoint, RaidView } from '../../../game/raid/raid-view.ts';
import { raidRunnerHeight } from '../../../game/raid/runner-motion.ts';

export function createQuarryMarks(scene: Scene) {
  const mask = new Texture('./assets/raid/spark_05.png', scene);
  mask.getAlphaFromRGB = true;
  const glow = new StandardMaterial('tracking mark magenta', scene);
  glow.opacityTexture = mask;
  glow.disableLighting = glow.disableDepthWrite = true;
  glow.emissiveColor = Color3.FromHexString('#ff49e7');
  const core = glow.clone('tracking mark core')!;
  core.emissiveColor = Color3.FromHexString('#ffddfb');
  const marks: Mesh[] = [];
  function makeMark() {
    const mark = MeshBuilder.CreatePlane('tracking dagger', { width: 0.8, height: 1.25 }, scene);
    mark.material = glow;
    mark.isPickable = false;
    mark.billboardMode = Mesh.BILLBOARDMODE_ALL;
    const light = MeshBuilder.CreatePlane(
      'tracking mark centre',
      { width: 0.18, height: 1 },
      scene,
    );
    light.parent = mark;
    light.material = core;
    light.isPickable = false;
    return mark;
  }
  return (
    view: RaidView,
    positions: readonly RaidPoint[],
    subtick: number,
    barHeight: (slot: number) => number,
  ) => {
    for (const caster of view.runners) {
      const target = caster.heroView.quarry;
      if (
        target == null ||
        caster.respawn ||
        (target !== 'wagon' && view.runners[target]!.respawn)
      ) {
        marks[caster.slot]?.setEnabled(false);
        continue;
      }
      const mark = (marks[caster.slot] ??= makeMark());
      const point = target === 'wagon' ? wagonCenter(view.tick + subtick) : positions[target]!;
      const height =
        target === 'wagon'
          ? 4.3
          : barHeight(target) + raidRunnerHeight(view.runners[target]!, subtick);
      mark.position.set(point.x, height, point.z);
      mark.setEnabled(true);
    }
  };
}
