import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
  VertexData,
  type Scene,
} from '@babylonjs/core';
import type { RaidHealingFlight, RaidPoint, RaidView, Team } from '../../../game/raid/raid-view.ts';
import { raidRoadTravel, raidRunnerHeight } from '../../../game/raid/runner-motion.ts';

const segments = 10;
const pulseTicks = 16;

function makeRibbon(scene: Scene, material: StandardMaterial) {
  const mesh = new Mesh('healing energy trail', scene);
  const data = new VertexData();
  const vertices = new Float32Array((segments + 1) * 6);
  data.positions = vertices;
  data.indices = [];
  data.colors = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    for (let side = 0; side < 2; side++)
      data.colors.push(0.18 + t * 0.5, 1, 0.16 + t * 0.35, 0.1 + t * 0.85);
    const j = i * 2;
    if (i > 0) data.indices.push(j - 2, j - 1, j, j, j - 1, j + 1);
  }
  data.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  return { mesh, vertices };
}

// Three crosses around the torso stay legible against both the road and the character's outfit.
function makeCrosses(scene: Scene, material: StandardMaterial) {
  const mesh = new Mesh('healing pulse', scene);
  const positions: number[] = [];
  const indices: number[] = [];
  function rect(x: number, y: number, w: number, h: number) {
    const j = positions.length / 3;
    positions.push(x - w, y - h, 0, x + w, y - h, 0, x + w, y + h, 0, x - w, y + h, 0);
    indices.push(j, j + 1, j + 2, j, j + 2, j + 3);
  }
  for (const [x, y, s] of [
    [-0.52, 0.02, 0.19],
    [0.5, 0.25, 0.15],
    [0.23, -0.26, 0.1],
  ] as const) {
    rect(x, y, s, s * 0.32);
    rect(x, y, s * 0.32, s);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  return mesh;
}

export function createRaidHealingEffects(scene: Scene) {
  const ribbonMaterial = new StandardMaterial('recovery green', scene);
  ribbonMaterial.disableLighting = ribbonMaterial.disableDepthWrite = true;
  ribbonMaterial.backFaceCulling = false;
  ribbonMaterial.emissiveColor = Color3.White();
  const spark = new Texture('./assets/raid/spark_05.png', scene);
  spark.getAlphaFromRGB = true;
  const light = ribbonMaterial.clone('recovery energy')!;
  light.opacityTexture = spark;
  light.emissiveColor = Color3.FromHexString('#abff74');
  const gold = light.clone('recovery arrival glow')!;
  gold.emissiveColor = Color3.FromHexString('#ffda72');
  const ivory = ribbonMaterial.clone('recovery crosses')!;
  ivory.emissiveColor = Color3.FromHexString('#fff6bf');
  function billboard(name: string, size: number, material: StandardMaterial) {
    const mesh = MeshBuilder.CreatePlane(name, { size }, scene);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }
  function makeFlight() {
    return {
      mote: billboard('healing energy mote', 0.68, light),
      ...makeRibbon(scene, ribbonMaterial),
    };
  }
  function makePulse() {
    return {
      crosses: makeCrosses(scene, ivory),
      glow: billboard('healing arrival glow', 1.6, gold),
    };
  }
  const flights: ReturnType<typeof makeFlight>[] = [];
  const pulses: ReturnType<typeof makePulse>[] = [];
  const lastHeal: number[] = [];
  const point = Vector3.Zero();
  function flightPoint(
    flight: RaidHealingFlight,
    startY: number,
    startZ: number,
    end: RaidPoint,
    endY: number,
    t: number,
  ) {
    const bend = Math.sin(Math.PI * t);
    const side = flight.target % 2 ? 1 : -1;
    point.set(
      flight.x + (end.x - flight.x) * t + side * 1.15 * bend,
      startY + (endY - startY) * t + 1.4 * bend,
      startZ + (end.z - startZ) * t,
    );
  }
  return (
    view: RaidView,
    positions: readonly RaidPoint[],
    subtick: number,
    localTeam: Team,
    barHeight: (slot: number) => number,
    reducedMotion: boolean,
  ) => {
    const now = view.tick + subtick;
    function visible(slot: number) {
      const r = view.runners[slot]!;
      return !r.respawn && (r.team === localTeam || (r.heroView.concealedUntil ?? 0) <= view.tick);
    }
    let count = 0;
    if (!view.result && !reducedMotion)
      for (const flight of view.healingFlights) {
        if (!visible(flight.target)) continue;
        const fx = (flights[count] ??= makeFlight());
        count++;
        const age = now - flight.started;
        const t = Math.min(1, Math.max(0, age / (flight.arrives - flight.started)));
        const end = positions[flight.target]!;
        const startY = flight.elevation + 0.5 * barHeight(flight.victim);
        const startZ = flight.z - raidRoadTravel(age);
        const endY =
          raidRunnerHeight(view.runners[flight.target]!, subtick) + 0.5 * barHeight(flight.target);
        fx.mote.setEnabled(true);
        fx.mesh.setEnabled(true);
        for (let i = 0; i <= segments; i++) {
          const u = i / segments;
          flightPoint(flight, startY, startZ, end, endY, Math.max(0, t - 0.24 * (1 - u)));
          const w = 0.07 * Math.sin(Math.PI * u);
          const j = i * 6;
          fx.vertices[j] = fx.vertices[j + 3] = point.x;
          fx.vertices[j + 1] = point.y - w;
          fx.vertices[j + 4] = point.y + w;
          fx.vertices[j + 2] = fx.vertices[j + 5] = point.z;
        }
        fx.mesh.updateVerticesData(VertexBuffer.PositionKind, fx.vertices, true);
        fx.mote.position.copyFrom(point);
      }
    for (let i = count; i < flights.length; i++) {
      flights[i]!.mote.setEnabled(false);
      flights[i]!.mesh.setEnabled(false);
    }
    lastHeal.fill(-Infinity);
    if (!view.result)
      for (const change of view.healthChanges) {
        const displayTick = change.displayTick ?? change.tick;
        if (change.amount > 0 && change.target !== 'wagon' && displayTick <= now)
          lastHeal[change.target] = Math.max(lastHeal[change.target] ?? -Infinity, displayTick);
      }
    for (const r of view.runners) {
      const age = now - (lastHeal[r.slot] ?? -Infinity);
      if (age < 0 || age >= pulseTicks || !visible(r.slot)) {
        pulses[r.slot]?.crosses.setEnabled(false);
        pulses[r.slot]?.glow.setEnabled(false);
        continue;
      }
      const fx = (pulses[r.slot] ??= makePulse());
      const { x, z } = positions[r.slot]!;
      const t = age / pulseTicks;
      const y = raidRunnerHeight(r, subtick) + 0.5 * barHeight(r.slot);
      fx.crosses.setEnabled(true);
      fx.crosses.position.set(x, y + (reducedMotion ? 0 : 0.6 * t), z);
      fx.crosses.visibility = Math.min(1, 3 * (1 - t));
      fx.glow.setEnabled(!reducedMotion);
      fx.glow.position.set(x, y, z);
      fx.glow.scaling.setAll(1.1 + 0.5 * t);
      fx.glow.visibility = 0.85 * (1 - t);
    }
  };
}
