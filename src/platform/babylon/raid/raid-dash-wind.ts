import { Color3, Mesh, StandardMaterial, VertexData, type Scene } from '@babylonjs/core';
import type { RaidHero } from '../../../game/raid/heroes/hero-id.ts';
import { actionLocked } from '../../../game/raid/raid-control.ts';
import type { RaidView, Skill } from '../../../game/raid/raid-view.ts';
import {
  raidRoadTravel,
  raidRunnerHeight,
  raidRunnerPositionAfter,
} from '../../../game/raid/runner-motion.ts';

const rushSkill: Partial<Record<RaidHero, Skill>> = {
  swift: 1,
  kaiken: 2,
  rildin: 2,
  magnus: 0,
  theresa: 1,
  drizz: 3,
};

function createWind(scene: Scene) {
  const mesh = new Mesh('rush wind', scene);
  const material = new StandardMaterial('rush wind light', scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  const strip = new VertexData();
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  // Two narrow streamlines split around the shoulders and taper towards the caster's wake.
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 12; i++) {
      const t = i / 12,
        bend = Math.sin(Math.PI * t);
      const x = side * (0.29 + 0.33 * bend + 0.42 * t);
      const y = 0.12 * side + 0.17 * bend - 0.22 * t;
      const width = 0.085 * bend,
        base = positions.length / 3;
      positions.push(x, y, -t, x + side * width, y + width, -t);
      colors.push(0.78, 0.92, 1, 0.8 * bend, 0.92, 0.97, 1, 0.2 * bend);
      if (i) indices.push(base - 2, base - 1, base, base, base - 1, base + 1);
    }
  }
  strip.positions = positions;
  strip.colors = colors;
  strip.indices = indices;
  strip.applyToMesh(mesh);
  mesh.material = material;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  return mesh;
}

export function createRaidDashWind(scene: Scene) {
  const pool: Mesh[] = [];
  return (view: RaidView, subtick: number) => {
    let count = 0;
    for (const r of view.runners) {
      const dash = r.dash;
      if (
        !dash ||
        rushSkill[r.hero] !== dash.skill ||
        view.result ||
        r.respawn ||
        actionLocked(r) ||
        r.heroView.rootedTicks ||
        raidRunnerHeight(r, subtick) > 0
      )
        continue;
      // The caster and the chase camera use wagon-relative metres. The dash endpoint is a road tile.
      const dx = dash.to.x - dash.from.x,
        dz = dash.to.z - dash.from.z - raidRoadTravel(dash.ticks);
      const speed = Math.hypot(dx, dz) / dash.ticks;
      const age = dash.elapsed + subtick;
      const length = Math.min(2, speed * Math.min(age, 3));
      if (length < 0.1 || age >= dash.ticks) continue;
      const mesh = (pool[count++] ??= pool[0]?.clone('rush wind') ?? createWind(scene));
      const center = raidRunnerPositionAfter(r, subtick);
      mesh.position.set(center.x, 0.88, center.z);
      mesh.rotation.y = Math.atan2(dx, dz);
      mesh.scaling.z = length;
      mesh.visibility = Math.min(1, age, dash.ticks - age);
      mesh.setEnabled(true);
    }
    for (let i = count; i < pool.length; i++) pool[i]!.setEnabled(false);
  };
}
