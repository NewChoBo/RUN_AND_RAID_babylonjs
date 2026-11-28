import { Color3, Mesh, StandardMaterial, VertexData, type Scene } from '@babylonjs/core';
import { RAID_ROAD_WIDTH } from '../../../game/raid/raid-rules.ts';
import type { RaidPoint, RaidView } from '../../../game/raid/raid-view.ts';
import { WAGON_BODY } from '../../../game/raid/wagon.ts';

const headHalfWidth = 1.12;

export function createRaidPingArrow(scene: Scene) {
  const arrow = new Mesh('team ping ground arrow', scene);
  const gold = new StandardMaterial('team ping amber', scene);
  gold.emissiveColor = Color3.FromHexString('#ffb72f');
  gold.disableLighting = gold.disableDepthWrite = true;
  gold.backFaceCulling = false;
  const shape = new VertexData();
  // The tail fades into the road. A second, detached chevron defines the point in perspective.
  const vertices = [
    // x, forward distance as a fraction of the arrow length, opacity
    [-0.82, 0, 0.04],
    [0.82, 0, 0.04],
    [-0.74, 0.62, 0.58],
    [0.74, 0.62, 0.58],
    [-headHalfWidth, 0.62, 0.72],
    [headHalfWidth, 0.62, 0.72],
    [0, 0.89, 0.86],
    [-headHalfWidth, 0.73, 0.82],
    [0, 0.95, 0.9],
    [headHalfWidth, 0.73, 0.82],
    [-headHalfWidth, 0.79, 0.82],
    [0, 1, 0.96],
    [headHalfWidth, 0.79, 0.82],
  ] as const;
  shape.positions = vertices.flatMap(([x, z]) => [x, 0, z]);
  shape.colors = vertices.flatMap(([, , alpha]) => [1, 1, 1, alpha]);
  shape.indices = [0, 2, 1, 1, 2, 3, 4, 6, 5, 7, 10, 8, 8, 10, 11, 8, 11, 9, 9, 11, 12];
  shape.applyToMesh(arrow);
  arrow.material = gold;
  arrow.hasVertexAlpha = true;
  arrow.isPickable = false;
  arrow.setEnabled(false);

  let lastAdvance: RaidView['calls'][number] = null;
  let advanceOffset = 0;
  return (call: RaidView['calls'][number], origin: RaidPoint, target?: RaidPoint, wagonX = 0) => {
    if (!call || ('target' in call && !target)) {
      arrow.setEnabled(false);
      return;
    }
    const movement = 'movement' in call;
    const dx = movement ? 0 : target!.x - origin.x;
    const dz = movement ? (call.movement === 'advance' ? 1 : -1) : target!.z - origin.z;
    const gap = Math.hypot(dx, dz);
    if (gap < 0.15) {
      arrow.setEnabled(false);
      return;
    }
    // The chase camera sees less road behind the runner than ahead.
    const reach = dz < 0 ? Math.min(5, (2.8 * gap) / -dz) : 5;
    const length = movement ? reach : Math.min(gap, reach);
    let x = origin.x;
    if (movement && call.movement === 'advance') {
      // Keep the arrow beside the runner, on the open side of the wagon, throughout this call.
      if (lastAdvance !== call) {
        const lane = origin.x - wagonX;
        const offset = Math.max(1.55, WAGON_BODY.halfWidth + 0.6 - Math.abs(lane));
        advanceOffset = lane < 0 ? -offset : offset;
        lastAdvance = call;
      }
      const edge = RAID_ROAD_WIDTH / 2 - headHalfWidth;
      x = Math.max(-edge, Math.min(edge, x + advanceOffset));
    }
    arrow.position.set(x, 0.035, origin.z);
    arrow.rotation.y = Math.atan2(dx, dz);
    arrow.scaling.set(Math.min(1, length / 2), 1, length);
    arrow.setEnabled(true);
  };
}
