import type { AbstractMesh } from '@babylonjs/core';
import { RAID_RIG_SCALE, RAID_RUNNER_SCALE } from './hero-appearance.ts';

// Workshop scenes measured 30.34 m and 17.21 m at the body mesh.
// Keep their provisional battle sizes until an original gameplay reference is available.
const workshopScale = new Map([
  ['goblin/default', 1 / 50],
  ['shaman/default', 1 / 10],
]);

/** Place a detached Player GLB so one authored metre occupies one course metre. */
export function placeSourceModel(root: AbstractMesh, outfitId?: string) {
  const scale = workshopScale.get(outfitId ?? '') ?? 1;
  root.scaling.scaleInPlace(scale / (RAID_RIG_SCALE * RAID_RUNNER_SCALE));
  const { min, max } = root.getHierarchyBoundingVectors(true);
  root.position.y -= min.y;
  return max.subtract(min);
}
