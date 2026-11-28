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
import type { RaidAction, RaidRunner } from '../../../game/raid/raid-view.ts';
import type { RaidHero } from '../../../game/raid/heroes/hero-id.ts';

type Spin = NonNullable<RaidRunner['spin']>;
export type WeaponSwing = RaidAction | Spin;
const historySize = 9;
const subdivisions = 4;
const rows = (historySize - 1) * subdivisions + 1;
const lifetime = 4;
const steel = [0.66, 0.8, 1, 0, 0.95, 0.98, 1, 0];
const sunlight = [1, 0.72, 0.32, 0, 1, 0.95, 0.73, 0];

type EdgeSample = { point: Vector3; tangent: Vector3 };
const makeEdgeSample = (): EdgeSample => ({ point: Vector3.Zero(), tangent: Vector3.Zero() });

// Velocities point from newer to older poses. At a stop or reversal, end the arc at the knot.
function updateTangent(
  newer: EdgeSample,
  current: EdgeSample,
  older: EdgeSample,
  before: number,
  after: number,
  rotating: boolean,
  outgoing: Vector3,
) {
  const { point, tangent } = current;
  if (!before) {
    older.point.subtractToRef(point, tangent).scaleInPlace(after ? 1 / after : 0);
    return;
  }
  point.subtractToRef(newer.point, tangent).scaleInPlace(1 / before);
  if (!after) return;
  older.point.subtractToRef(point, outgoing).scaleInPlace(1 / after);
  const dot = Vector3.Dot(tangent, outgoing);
  const incomingSpeed = tangent.length(),
    outgoingSpeed = outgoing.length();
  if (!incomingSpeed || !outgoingSpeed || (dot <= 0 && !rotating)) {
    tangent.setAll(0);
    return;
  }
  tangent.scaleInPlace(1 / incomingSpeed).addInPlace(outgoing.scaleInPlace(1 / outgoingSpeed));
  const speed = Math.min(incomingSpeed, outgoingSpeed);
  if (rotating) {
    // A fast continuous sweep can turn past 90 degrees between frames. Fade its
    // tangent towards zero near a U-turn, where the intervening path is ambiguous.
    const alignment = dot / (incomingSpeed * outgoingSpeed);
    const turnWeight = Math.max(0, Math.min(1, 8 * (1 + alignment)));
    tangent.normalize().scaleInPlace(speed * turnWeight);
  } else tangent.scaleInPlace(0.5 * speed);
}

function writeCurvePoint(
  positions: Float32Array,
  offset: number,
  start: EdgeSample,
  end: EdgeSample,
  t: number,
  ticks: number,
) {
  // Cubic Hermite passes through both measured positions with their shared tangents.
  const blend = t * t * (3 - 2 * t);
  const depart = ticks * t * (1 - t) * (1 - t);
  const arrive = -ticks * t * t * (1 - t);
  const { point: a, tangent: va } = start,
    { point: b, tangent: vb } = end;
  positions[offset] = a.x + (b.x - a.x) * blend + va.x * depart + vb.x * arrive;
  positions[offset + 1] = a.y + (b.y - a.y) * blend + va.y * depart + vb.y * arrive;
  positions[offset + 2] = a.z + (b.z - a.z) * blend + va.z * depart + vb.z * arrive;
}

function weaponEdge(body: AbstractMesh, bone: Bone, axis: 'x' | 'z', innerFraction: number) {
  const node = bone.getTransformNode();
  const positions = body.getVerticesData(VertexBuffer.PositionKind);
  const joints = body.getVerticesData(VertexBuffer.MatricesIndicesKind);
  const weights = body.getVerticesData(VertexBuffer.MatricesWeightsKind);
  if (!node || !positions || !joints || !weights) return;
  // The weapon is merged into the skinned fighter. Use vertices rigidly bound to its
  // own prop, so a wider hammer head or a shorter blade follows the equipped skin.
  const vertices: Vector3[] = [];
  let tip: Vector3 | undefined;
  const inverseBind = bone.getAbsoluteInverseBindMatrix();
  const joint = bone.getIndex();
  for (let i = 0; i < positions.length / 3; i++) {
    if (joints[i * 4] !== joint || weights[i * 4]! < 0.99) continue;
    const point = Vector3.FromArray(positions, i * 3);
    Vector3.TransformCoordinatesToRef(point, inverseBind, point);
    vertices.push(point);
    if (!tip || point[axis] > tip[axis]) tip = point;
  }
  if (!tip || tip[axis] <= 0) return;
  const target = tip.scale(innerFraction);
  const inner = vertices.reduce((best, point) =>
    Vector3.DistanceSquared(target, point) < Vector3.DistanceSquared(target, best) ? point : best,
  );
  return { node, tip, inner };
}

function makeRibbon(
  body: AbstractMesh,
  hero: RaidHero,
  edge: NonNullable<ReturnType<typeof weaponEdge>>,
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

  const samples = Array.from({ length: historySize }, () => ({
    at: 0,
    base: makeEdgeSample(),
    tip: makeEdgeSample(),
    relativeTip: Vector3.Zero(),
    direction: Vector3.Zero(),
    strength: 0,
  }));
  const outgoing = Vector3.Zero();
  const turnIn = Vector3.Zero(),
    turnOut = Vector3.Zero();
  let count = 0,
    lastCue: number | Spin | undefined;

  function hide() {
    count = 0;
    lastCue = undefined;
    mesh.setEnabled(false);
  }
  return {
    hide,
    dispose: () => mesh.dispose(false, true),
    draw(cue: number | Spin, now: number, origin: Vector3, empowered: boolean) {
      const elapsed = now - samples[0]!.at;
      if (cue !== lastCue || elapsed < 0 || elapsed >= lifetime) hide();
      if (count && !elapsed) return;
      lastCue = cue;
      // Keep a live leading edge at 120Hz; retain history at most every half combat tick.
      if (count <= 1 || samples[0]!.at - samples[1]!.at >= 0.5 - 1e-6) {
        samples.unshift(samples.pop()!);
        count = Math.min(count + 1, historySize);
      }
      const head = samples[0]!,
        world = edge.node.computeWorldMatrix(true);
      head.at = now;
      Vector3.TransformCoordinatesToRef(edge.inner, world, head.base.point);
      Vector3.TransformCoordinatesToRef(edge.tip, world, head.tip.point);
      head.tip.point.subtractToRef(origin, head.relativeTip);
      head.tip.point.subtractToRef(head.base.point, head.direction).normalize();
      if (count < 2) return;
      const ink =
        hero === 'hammer' || hero === 'kali' || (hero === 'rildin' && empowered) ? sunlight : steel;
      if (ink !== palette) {
        for (let i = 0; i < rows; i++) colors.set(ink, i * 8);
        palette = ink;
      }
      for (let i = 0; i < count; i++) {
        const newer = samples[Math.max(0, i - 1)]!;
        const s = samples[i]!;
        const older = samples[Math.min(i + 1, count - 1)]!;
        const before = newer.at - s.at,
          after = s.at - older.at;
        Vector3.CrossToRef(newer.direction, s.direction, turnIn);
        Vector3.CrossToRef(s.direction, older.direction, turnOut);
        // Both orientation changes must be substantial and about a common axis.
        const rotating = Vector3.Dot(turnIn, turnOut) > 0.1;
        updateTangent(newer.base, s.base, older.base, before, after, rotating, outgoing);
        updateTangent(newer.tip, s.tip, older.tip, before, after, rotating, outgoing);
        const speed = Vector3.Distance(s.relativeTip, older.relativeTip) / Math.max(0.01, after);
        s.strength = Math.min(1, Math.max(0, (speed - 0.04) / 0.16));
      }
      let row = 0,
        visible = false;
      for (let i = 0; i + 1 < count; i++) {
        const a = samples[i]!,
          b = samples[i + 1]!,
          ticks = a.at - b.at;
        const end = Math.min(1, (lifetime - (now - a.at)) / ticks);
        for (let step = i ? 1 : 0; step <= subdivisions; step++) {
          const t = Math.min(step / subdivisions, end);
          writeCurvePoint(positions, row * 6, a.base, b.base, t, ticks);
          writeCurvePoint(positions, row * 6 + 3, a.tip, b.tip, t, ticks);
          const age = now - a.at + t * ticks;
          const alpha =
            Math.max(0, 1 - age / lifetime) * (a.strength + (b.strength - a.strength) * t);
          colors[row * 8 + 3] = 0.12 * alpha;
          colors[row * 8 + 7] = 0.88 * alpha;
          visible ||= alpha > 0;
          row++;
          if (t === end) break;
        }
        if (now - b.at >= lifetime) break;
      }
      mesh.setEnabled(visible);
      if (!visible) return;
      // Collapse unused rows to the tail so an old stroke cannot extend the mesh bounds.
      for (; row < rows; row++) {
        positions.copyWithin(row * 6, (row - 1) * 6, row * 6);
        colors[row * 8 + 3] = colors[row * 8 + 7] = 0;
      }
      mesh.updateVerticesData(VertexBuffer.PositionKind, positions, true);
      mesh.updateVerticesData(VertexBuffer.ColorKind, colors);
    },
  };
}

/** Bind to the imported weapon, independently for each hand and equipped skin. */
export function createSwordAfterimage(hero: RaidHero, meshes: readonly AbstractMesh[]) {
  if (!['hammer', 'rildin', 'swift', 'kaiken', 'kali'].includes(hero)) return;
  const body = meshes.find((m) => m.skeleton);
  if (!body?.skeleton) return;
  const names =
    hero === 'hammer'
      ? ['wp_bn']
      : hero === 'kali'
        ? ['Lswordbone', 'Rswordbone']
        : ['Bip001 Prop1'];
  const ribbons = body.skeleton.bones.flatMap((bone) => {
    if (!names.includes(bone.name)) return [];
    const edge = weaponEdge(
      body,
      bone,
      hero === 'hammer' || hero === 'kali' ? 'x' : 'z',
      hero === 'hammer' ? 0.7 : 0.22,
    );
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
    draw(cue: WeaponSwing | undefined, now: number, origin: Vector3, empowered = false) {
      if (
        cue &&
        ('remaining' in cue ||
          cue.skill === 'basic' ||
          ((hero === 'rildin' || hero === 'kali' || hero === 'hammer') && cue.skill === 0) ||
          (hero === 'swift' && cue.skill === 1) ||
          (hero === 'kaiken' && cue.phase === 'spin'))
      ) {
        // A knockback or pull can instantly move the runner between two samples.
        if (Vector3.DistanceSquared(previousOrigin, origin) > 1) hide();
        previousOrigin.copyFrom(origin);
        for (const ribbon of ribbons)
          ribbon.draw('id' in cue ? cue.id : cue, now, origin, empowered);
      } else hide();
    },
  };
}
