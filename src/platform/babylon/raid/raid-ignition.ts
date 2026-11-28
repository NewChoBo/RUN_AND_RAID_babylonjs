import { MeshBuilder, type Mesh, type Scene } from '@babylonjs/core';
import { RAID_HZ, WAGON } from '../../../game/raid/raid-rules.ts';
import { raidRunnerHeight, raidRunnerPositionAfter } from '../../../game/raid/runner-motion.ts';
import type { RaidView } from '../../../game/raid/raid-view.ts';
import { raidMaterial } from './raid-material.ts';

/** The flames belong to the marked target and brighten on the scheduled damage tick. */
export function createIgnitionFx(scene: Scene) {
  const flame = raidMaterial(scene, 'ignite ember', '#ff731d', 1);
  const core = raidMaterial(scene, 'ignite core', '#ffdb71', 1);
  const pool: Mesh[][] = [];
  function cluster() {
    return Array.from({ length: 5 }, (_, i) => {
      const mesh = MeshBuilder.CreateCylinder(
        'ignite flame',
        {
          height: 1,
          diameterBottom: 0.34,
          diameterTop: 0.015,
          tessellation: 5,
        },
        scene,
      );
      mesh.material = i % 2 ? core : flame;
      mesh.isPickable = false;
      return mesh;
    });
  }
  return (view: RaidView, subtick: number) => {
    let used = 0;
    for (const caster of view.runners) {
      for (const burn of caster.heroView.burns ?? []) {
        const target = burn.target === 'wagon' ? undefined : view.runners[burn.target];
        if (target?.respawn) continue;
        const center = target ? raidRunnerPositionAfter(target, subtick) : WAGON;
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
          mesh.scaling.set(size, size * 1.35, size);
          mesh.rotation.z = 0.22 * Math.sin(a);
          mesh.setEnabled(true);
        }
      }
    }
    for (let i = used; i < pool.length; i++) for (const mesh of pool[i]!) mesh.setEnabled(false);
  };
}
