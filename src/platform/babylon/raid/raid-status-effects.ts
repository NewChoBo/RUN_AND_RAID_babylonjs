import { Mesh, VertexData, type Scene } from '@babylonjs/core';
import { activeSlow } from '../../../game/raid/raid-control.ts';
import type { RaidPoint, RaidView, Team } from '../../../game/raid/raid-view.ts';
import { raidRunnerHeight } from '../../../game/raid/runner-motion.ts';
import { raidMaterial } from './raid-material.ts';

type Point = [number, number, number];
type Stroke = [number, number][];
const glyphs: Record<'silence' | 'taunt' | 'blind', Stroke[]> = {
  // A crossed speech bubble, an anger mark and a closed eye.
  silence: [
    [
      [-0.2, 0.13],
      [0.2, 0.13],
      [0.2, -0.07],
      [-0.04, -0.07],
      [-0.14, -0.16],
      [-0.14, -0.07],
      [-0.2, -0.07],
      [-0.2, 0.13],
    ],
    [
      [-0.19, -0.18],
      [0.19, 0.2],
    ],
  ],
  taunt: [
    [
      [-0.18, 0.03],
      [-0.08, 0.07],
      [-0.03, 0.18],
    ],
    [
      [0.04, 0.16],
      [0.08, 0.08],
      [0.18, 0.04],
    ],
    [
      [0.17, -0.04],
      [0.08, -0.08],
      [0.04, -0.17],
    ],
    [
      [-0.04, -0.18],
      [-0.08, -0.08],
      [-0.18, -0.04],
    ],
  ],
  blind: [
    [
      [-0.23, 0.07],
      [-0.11, -0.025],
      [0, -0.05],
      [0.11, -0.025],
      [0.23, 0.07],
    ],
    [
      [-0.12, -0.02],
      [-0.18, -0.12],
    ],
    [
      [0, -0.04],
      [0, -0.15],
    ],
    [
      [0.12, -0.02],
      [0.18, -0.12],
    ],
  ],
};
const colors = {
  stun: '#ffe16a',
  slow: '#7fdfff',
  haste: '#97ffac',
  silence: '#e3a5ff',
  taunt: '#ff8364',
  blind: '#cfbeff',
};
type Status = keyof typeof colors;
const statuses = Object.keys(colors) as Status[];

function makeStatusMesh(scene: Scene, kind: Status) {
  const positions: number[] = [];
  const indices: number[] = [];
  function polygon(...points: Point[]) {
    const base = positions.length / 3;
    for (const point of points) positions.push(...point);
    for (let i = 2; i < points.length; i++) indices.push(base, base + i - 1, base + i);
  }
  if (kind === 'silence' || kind === 'taunt' || kind === 'blind') {
    for (const stroke of glyphs[kind]) {
      for (let i = 1; i < stroke.length; i++) {
        const [x, y] = stroke[i - 1]!;
        const [endX, endY] = stroke[i]!;
        const width = 0.025 / Math.hypot(endX - x, endY - y);
        const nx = (endY - y) * width;
        const ny = (x - endX) * width;
        polygon(
          [x + nx, y + ny, 0],
          [x - nx, y - ny, 0],
          [endX - nx, endY - ny, 0],
          [endX + nx, endY + ny, 0],
        );
      }
    }
  } else {
    // Dazed stars orbit the crown, frost clasps the ankles, and rising wind curls mark haste.
    for (let sector = 0; sector < 3; sector++) {
      const start = (sector * Math.PI * 2) / 3;
      function edge(t: number, top: boolean): Point {
        const angle = start + t * 1.64;
        const radius = kind === 'stun' ? 0.42 : 0.46;
        const lift = kind === 'haste' ? 0.24 * t : 0;
        const width = kind === 'stun' ? 0.025 : 0.08;
        return [
          radius * Math.cos(angle),
          lift + (top ? width * Math.sin(Math.PI * t) : 0),
          radius * Math.sin(angle),
        ];
      }
      for (let i = 0; i < 8; i++)
        polygon(
          edge(i / 8, false),
          edge((i + 1) / 8, false),
          edge((i + 1) / 8, true),
          edge(i / 8, true),
        );
      const [x, y, z] = edge(0.5, false);
      if (kind === 'slow') {
        polygon(edge(0.35, false), edge(0.65, false), [x, y - 0.12, z]);
      } else if (kind === 'stun') {
        // Two crossed star faces keep the fast-moving silhouette visible from either side.
        for (const plane of [0, Math.PI / 2]) {
          const point = (i: number): Point => {
            const angle = (i * Math.PI) / 5;
            const radius = i % 2 ? 0.064 : 0.15;
            const side = radius * Math.sin(angle);
            return [
              x + side * Math.cos(plane),
              y + radius * Math.cos(angle),
              z + side * Math.sin(plane),
            ];
          };
          for (let i = 0; i < 10; i++) polygon([x, y, z], point(i), point(i + 1));
        }
      }
    }
  }
  const mesh = new Mesh('runner ' + kind, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.applyToMesh(mesh);
  const material = raidMaterial(scene, kind + ' status', colors[kind], 1);
  material.disableLighting = true;
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.isPickable = false;
  if (kind === 'silence' || kind === 'taunt' || kind === 'blind')
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
  return mesh;
}

export function createRaidStatusEffects(scene: Scene) {
  const sources: Partial<Record<Status, Mesh>> = {};
  const pools: Partial<Record<Status, Mesh>>[] = [];
  const active = {
    stun: false,
    slow: false,
    haste: false,
    silence: false,
    taunt: false,
    blind: false,
  };
  return (
    view: RaidView,
    positions: readonly RaidPoint[],
    subtick: number,
    localTeam: Team,
    barHeight: (slot: number) => number,
    reducedMotion: boolean,
  ) => {
    const phase = reducedMotion ? 0 : (view.tick + subtick) * 0.085;
    for (let slot = 0; slot < Math.max(pools.length, view.runners.length); slot++) {
      const r = view.runners[slot];
      const pool = (pools[slot] ??= {});
      if (
        !r ||
        r.respawn ||
        r.hp <= 0 ||
        view.result ||
        (r.team !== localTeam && (r.heroView.concealedUntil ?? 0) > view.tick)
      ) {
        for (const kind of statuses) pool[kind]?.setEnabled(false);
        continue;
      }
      active.stun = r.stunned > 0;
      active.slow = !!activeSlow(r);
      active.haste = r.hasteTicks > 0;
      active.silence = r.silenced > 0;
      active.taunt = (r.taunt?.until ?? 0) > view.tick;
      active.blind = r.blindUntil > view.tick;
      const glyphCount = Number(active.silence) + Number(active.taunt) + Number(active.blind);
      let glyphX = (1 - glyphCount) * 0.27;
      const point = positions[slot]!;
      const height = raidRunnerHeight(r, subtick);
      for (const kind of statuses) {
        if (!active[kind]) {
          pool[kind]?.setEnabled(false);
          continue;
        }
        let mesh = pool[kind];
        if (!mesh) {
          const source = sources[kind];
          mesh = source ? source.clone(source.name) : makeStatusMesh(scene, kind);
          sources[kind] ??= mesh;
          pool[kind] = mesh;
        }
        mesh.setEnabled(true);
        if (kind === 'stun') {
          mesh.position.set(point.x, height + barHeight(slot) - 0.26, point.z);
          mesh.rotation.y = phase;
        } else if (kind === 'slow' || kind === 'haste') {
          mesh.position.set(point.x, height + (kind === 'slow' ? 0.2 : 0.29), point.z);
          mesh.rotation.y = kind === 'slow' ? -phase / 4 : phase;
        } else {
          mesh.position.set(point.x + glyphX, height + barHeight(slot) + 0.32, point.z);
          glyphX += 0.54;
        }
      }
    }
  };
}
