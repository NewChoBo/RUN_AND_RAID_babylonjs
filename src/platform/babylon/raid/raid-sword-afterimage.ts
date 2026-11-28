import {
  Color3,
  Mesh,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
  type AbstractMesh,
  type Bone,
} from '@babylonjs/core';
import type { RaidAction } from '../../../game/raid/raid-view.ts';
import type { RaidHero } from '../../../game/raid/heroes/hero-id.ts';

const rows = 9;
const lifetime = 4;
const steel = [0.66, 0.8, 1, 0, 0.95, 0.98, 1, 0];
const sunlight = [1, 0.72, 0.32, 0, 1, 0.95, 0.73, 0];

function bladeEdge(body: AbstractMesh, bone: Bone, axis: 'x' | 'z') {
  const node = bone.getTransformNode();
  const positions = body.getVerticesData(VertexBuffer.PositionKind);
  const joints = body.getVerticesData(VertexBuffer.MatricesIndicesKind);
  const weights = body.getVerticesData(VertexBuffer.MatricesWeightsKind);
  if (!node || !positions || !joints || !weights) return;
  // The weapon is merged into the skinned fighter. Measure this skin's furthest blade vertex
  // along the prop's authored axis, excluding the hilt and Kali's separate sheaths.
  const tip = Vector3.Zero(),
    point = Vector3.Zero();
  const inverseBind = bone.getAbsoluteInverseBindMatrix();
  const joint = bone.getIndex();
  for (let i = 0; i < positions.length / 3; i++) {
    if (joints[i * 4] !== joint || weights[i * 4]! < 0.99) continue;
    Vector3.FromArrayToRef(positions, i * 3, point);
    Vector3.TransformCoordinatesToRef(point, inverseBind, point);
    if (point[axis] > tip[axis]) tip.copyFrom(point);
  }
  if (tip[axis] <= 0) return;
  return { node, tip };
}

function makeRibbon(
  body: AbstractMesh,
  hero: RaidHero,
  edge: NonNullable<ReturnType<typeof bladeEdge>>,
) {
  const scene = body.getScene();
  const mesh = new Mesh(hero + ' blade afterimage', scene);
  const material = new StandardMaterial(hero + ' afterimage light', scene);
  material.disableLighting = material.disableDepthWrite = true;
  material.backFaceCulling = false;
  material.emissiveColor = Color3.White();
  mesh.material = material;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  mesh.setEnabled(false);

  const positions = new Float32Array(rows * 6);
  const colors = new Float32Array(rows * 8);
  let palette: number[] | undefined;
  const data = new VertexData();
  const indices: number[] = [];
  for (let i = 0; i < rows; i++) {
    if (i) {
      const v = 2 * i;
      indices.push(v - 2, v - 1, v, v, v - 1, v + 1);
    }
  }
  data.indices = indices;
  data.positions = positions;
  data.colors = colors;
  data.applyToMesh(mesh, true);

  const samples = Array.from({ length: rows }, () => ({
    at: 0,
    base: Vector3.Zero(),
    tip: Vector3.Zero(),
    relativeTip: Vector3.Zero(),
  }));
  const inner = edge.tip.scale(0.22);
  let count = 0,
    nextSample = 0,
    lastCue: number | undefined;

  function hide() {
    count = 0;
    lastCue = undefined;
    mesh.setEnabled(false);
  }
  return {
    hide,
    dispose: () => mesh.dispose(false, true),
    draw(cue: number, now: number, origin: Vector3, empowered: boolean) {
      const elapsed = now - samples[0]!.at;
      if (cue !== lastCue || elapsed < 0 || elapsed >= lifetime) hide();
      if (count && !elapsed) return;
      lastCue = cue;
      if (count <= 1 || now >= nextSample) {
        samples.unshift(samples.pop()!);
        count = Math.min(count + 1, rows);
        nextSample = now + 0.5;
      }
      const head = samples[0]!,
        world = edge.node.computeWorldMatrix(true);
      head.at = now;
      Vector3.TransformCoordinatesToRef(inner, world, head.base);
      Vector3.TransformCoordinatesToRef(edge.tip, world, head.tip);
      head.tip.subtractToRef(origin, head.relativeTip);
      const ink = hero === 'kali' || (hero === 'rildin' && empowered) ? sunlight : steel;
      if (ink !== palette) {
        for (let i = 0; i < rows; i++) colors.set(ink, i * 8);
        palette = ink;
      }
      let visible = false;
      for (let i = 0; i < rows; i++) {
        const s = samples[Math.min(i, count - 1)]!;
        const older = samples[Math.min(i + 1, count - 1)]!;
        const speed =
          Vector3.Distance(s.relativeTip, older.relativeTip) / Math.max(0.01, s.at - older.at);
        const alpha =
          Math.max(0, 1 - (now - s.at) / lifetime) *
          Math.min(1, Math.max(0, (speed - 0.04) / 0.16));
        visible ||= alpha > 0;
        s.base.toArray(positions, i * 6);
        s.tip.toArray(positions, i * 6 + 3);
        colors[i * 8 + 3] = 0.12 * alpha;
        colors[i * 8 + 7] = 0.88 * alpha;
      }
      mesh.setEnabled(visible);
      if (!visible) return;
      mesh.updateVerticesData(VertexBuffer.PositionKind, positions, true);
      mesh.updateVerticesData(VertexBuffer.ColorKind, colors);
    },
  };
}

/** Bind to the imported weapon, independently for each hand and equipped skin. */
export function createSwordAfterimage(hero: RaidHero, meshes: readonly AbstractMesh[]) {
  if (hero !== 'rildin' && hero !== 'swift' && hero !== 'kaiken' && hero !== 'kali') return;
  const body = meshes.find((m) => m.skeleton);
  if (!body?.skeleton) return;
  const names = hero === 'kali' ? ['Lswordbone', 'Rswordbone'] : ['Bip001 Prop1'];
  const ribbons = body.skeleton.bones.flatMap((bone) => {
    if (!names.includes(bone.name)) return [];
    const edge = bladeEdge(body, bone, hero === 'kali' ? 'x' : 'z');
    return edge ? [makeRibbon(body, hero, edge)] : [];
  });
  if (!ribbons.length) return;
  const previousOrigin = Vector3.Zero();
  function hide() {
    for (const ribbon of ribbons) ribbon.hide();
  }
  return {
    hide,
    dispose() {
      for (const ribbon of ribbons) ribbon.dispose();
    },
    draw(cue: RaidAction | undefined, now: number, origin: Vector3, empowered = false) {
      if (
        cue &&
        (cue.skill === 'basic' ||
          ((hero === 'rildin' || hero === 'kali') && cue.skill === 0) ||
          (hero === 'swift' && cue.skill === 1))
      ) {
        // A knockback or pull can instantly move the runner between two samples.
        if (Vector3.DistanceSquared(previousOrigin, origin) > 1) hide();
        previousOrigin.copyFrom(origin);
        for (const ribbon of ribbons) ribbon.draw(cue.id, now, origin, empowered);
      } else hide();
    },
  };
}
