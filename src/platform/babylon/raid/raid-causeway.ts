import {
  Color3,
  Curve3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  Texture,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core';
import { RAID_ELECTRIC_GRID, raidElectricRowZ } from '../../../game/raid/raid-boss.ts';
import { RAID_HZ, RAID_ROAD_WIDTH } from '../../../game/raid/raid-rules.ts';
import { raidMaterial } from './raid-material.ts';

// One repeat covers both banks. The rock profile meets its neighbour at either end.
const spanLength = 72;
const halfRoad = RAID_ROAD_WIDTH / 2;

function bankPoint(side: number, z: number, ledge: number) {
  const turn = (2 * Math.PI * z) / spanLength;
  const shift = side * 1.9 + ledge * 0.42;
  const broad = Math.sin(turn * 2 + shift);
  const narrow = Math.sin(turn * 5 + shift * 2.1);
  const ridge = Math.sin(turn * 3 + side) + Math.cos(turn * 7 - shift) * 0.32;
  const x = [10.9, 14.8, 14.2, 18.2, 17.9, 23.7, 32.5][ledge]!;
  const y = [-6.8, -3.7, 1.9, 3.1, 8.9, 14.8, 13.4][ledge]!;
  return new Vector3(
    side * (x + broad * 1.7 + narrow * 0.75),
    y + ridge * (1 + ledge * 0.6) + broad * 1.65,
    z,
  );
}

function canyonBank(scene: Scene) {
  const positions: number[] = [],
    indices: number[] = [],
    colors: number[] = [],
    uvs: number[] = [];
  const ledges = 7;
  for (const side of [-1, 1]) {
    const first = positions.length / 3;
    for (let step = 0; step <= 24; step++) {
      const z = (step / 24 - 0.5) * spanLength;
      for (let ledge = 0; ledge < ledges; ledge++) {
        const v = bankPoint(side, z, ledge);
        positions.push(v.x, v.y, v.z);
        uvs.push(z / 6, (Math.abs(v.x) + v.y) / 6);
        // Moss collects on broken shelves, keeping vertical faces in ochre sandstone.
        const turn = (z * 2 * Math.PI) / spanLength;
        const moss =
          [0.32, 0.36, 0.76, 0.98, 0.15, 0.75, 0.6][ledge]! *
          (0.68 + 0.32 * Math.sin(turn * 4 + side));
        const shade =
          [0.48, 0.55, 0.88, 0.91, 0.64, 0.93, 0.8][ledge]! *
          (0.82 + 0.18 * Math.sin(turn * 3 + side * 2 + ledge));
        colors.push(
          shade * (1 - moss * 0.52),
          shade * (0.85 + moss * 0.19),
          shade * (0.69 - moss * 0.43),
          1,
        );
        if (step === 0 || ledge === 0) continue;
        const d = first + step * ledges + ledge;
        const a = d - ledges - 1,
          b = d - ledges,
          c = d - 1;
        if (side > 0) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs, colors });
  const bank = new Mesh('sunlit canyon banks', scene);
  data.applyToMesh(bank);
  const material = raidMaterial(scene, 'weathered canyon walls', '#e7d9bf');
  material.diffuseTexture = new Texture('./assets/polyhaven/rock_pitted_mossy_diff_1k.webp', scene);
  bank.material = material;
  bank.isPickable = false;
  return bank;
}

function bridgeStonework(scene: Scene) {
  const material = raidMaterial(scene, 'rust sandstone', '#ae796b');
  material.diffuseTexture = new Texture('./assets/polyhaven/rock_pitted_mossy_diff_1k.webp', scene);
  const pieces: Mesh[] = [];
  function stone(x: number, y: number, z: number, w: number, h: number, d: number, shade: number) {
    const part = MeshBuilder.CreateBox('bridge stone', { width: w, height: h, depth: d }, scene);
    part.position.set(x, y, z);
    const vertices = part.getVerticesData(VertexBuffer.PositionKind)!;
    const normals = part.getVerticesData(VertexBuffer.NormalKind)!;
    const uvs: number[] = [],
      colors: number[] = [];
    for (let i = 0; i < vertices.length; i += 3) {
      const alongX = Math.abs(normals[i]!) > 0.5;
      const horizontal = Math.abs(normals[i + 1]!) > 0.5;
      uvs.push(
        (alongX ? vertices[i + 2]! + z : vertices[i]! + x) / 3.2,
        (horizontal ? vertices[i + 2]! + z : vertices[i + 1]! + y) / 3.2,
      );
      colors.push(shade, shade, shade, 1);
    }
    part.setVerticesData(VertexBuffer.UVKind, uvs);
    part.setVerticesData(VertexBuffer.ColorKind, colors);
    part.material = material;
    pieces.push(part);
  }
  function merge(name: string) {
    const result = Mesh.MergeMeshes(pieces, true)!;
    result.name = name;
    result.isPickable = false;
    pieces.length = 0;
    return result;
  }
  for (const side of [-1, 1]) {
    const x = side * (halfRoad + 0.24);
    stone(x, -0.45, 0, 1.05, 1.56, spanLength, 0.79);
    stone(x, 0.53, 0, 0.71, 0.52, spanLength, 0.89);
    stone(x, 0.8, 0, 0.83, 0.13, spanLength, 1);
    for (let z = -spanLength / 2 + 4.5; z < spanLength / 2; z += 9) {
      stone(x, 0.75, z, 1.08, 1.5, 1.14, 0.9);
      stone(x, 1.54, z, 1.25, 0.18, 1.34, 1);
      stone(x, 1.71, z, 0.92, 0.18, 1.01, 0.92);
    }
  }
  const rails = merge('moulded stone parapets');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = side * 10.5;
      const z = -12 + i * 7;
      const h = 13 - 1.35 * i;
      stone(x, h / 2, z, 2.1, h, 2.4, 0.73);
      stone(x, h - 0.5, z, 2.6, 0.8, 2.9, 0.91);
      stone(x, h + 0.16, z, 3.35, 0.56, 3.5, 1);
    }
    stone(side * 5, 3.1, 0, 1.4, 6.2, 2.6, 0.82);
  }
  stone(0, 6.3, 0, 11.8, 0.8, 1.8, 0.85);
  return { rails, gate: merge('distant canyon gate') };
}

function canyonFalls(scene: Scene) {
  const water = raidMaterial(scene, 'sunlit falling water', '#e4f4fa');
  water.disableLighting = true;
  const streaks = new DynamicTexture('waterfall streaks', { width: 128, height: 256 }, scene, true);
  const context = streaks.getContext();
  const pixels = context.getImageData(0, 0, 128, 256);
  // Tileable value noise lets ribbons of foam split and rejoin as the sheet descends.
  function noise(x: number, v: number, frequency: number) {
    const iy = Math.floor(v * frequency),
      ix = Math.floor(x);
    const sx = x - ix,
      sy = v * frequency - iy;
    const tx = sx * sx * (3 - 2 * sx),
      ty = sy * sy * (3 - 2 * sy);
    function sample(column: number, row: number) {
      const seed = Math.sin(column * 127.1 + (row % frequency) * 311.7) * 43758.5453;
      return seed - Math.floor(seed);
    }
    const a = sample(ix, iy),
      b = sample(ix + 1, iy);
    const c = sample(ix, iy + 1),
      d = sample(ix + 1, iy + 1);
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
  for (let y = 0; y < 256; y++) {
    const v = y / 256;
    for (let x = 0; x < 128; x++) {
      const u = x / 127;
      const eddy = noise(u * 9, v, 6);
      const flow = u + 0.13 * (eddy - 0.5);
      const foam =
        noise(flow * 19, v, 9) * 0.46 +
        noise(flow * 43, v, 13) * 0.34 +
        noise(flow * 81, v, 25) * 0.2;
      const light = Math.max(0, Math.min(1, (foam - 0.34) * 2.9));
      const edge = Math.max(0, Math.min(1, (0.5 - Math.abs(u - 0.5)) * 10 - 1.3 * (eddy - 0.3)));
      const i = (y * 128 + x) * 4;
      pixels.data.set(
        [111 + 144 * light, 182 + 73 * light, 190 + 65 * light, edge * (85 + 170 * light)],
        i,
      );
    }
  }
  context.putImageData(pixels, 0, 0);
  streaks.update();
  streaks.hasAlpha = true;
  streaks.wrapU = Texture.CLAMP_ADDRESSMODE;
  streaks.wrapV = Texture.WRAP_ADDRESSMODE;
  streaks.vScale = 1.4;
  water.emissiveTexture = streaks;
  water.diffuseTexture = streaks;
  water.useAlphaFromDiffuseTexture = true;
  water.backFaceCulling = false;
  const sheets: Mesh[] = [];
  for (const side of [-1, 1]) {
    const z = side < 0 ? 17 : 26;
    const edges = [-1, -0.5, 0, 0.5, 1].map((edge) =>
      Curve3.CreateCatmullRomSpline(
        [5, 4, 2, 0].map((ledge) => {
          const v = bankPoint(side, z + edge * 0.8, ledge);
          v.x -= side * (1.4 + Math.cos(edge * 3 + ledge) * 0.25);
          v.z += edge * (1.7 + (5 - ledge) * 0.22);
          return v;
        }),
        4,
      ).getPoints(),
    );
    const sheet = MeshBuilder.CreateRibbon(
      'falling stream',
      { pathArray: edges, invertUV: true },
      scene,
    );
    sheet.material = water;
    sheets.push(sheet);
  }
  const falls = Mesh.MergeMeshes(sheets, true)!;
  falls.name = 'canyon waterfalls';
  falls.isPickable = false;
  return { falls, streaks };
}

export function createRaidCauseway(scene: Scene) {
  const grid = RAID_ELECTRIC_GRID;
  const rows = 65;
  const length = rows * grid.depth;
  const ground = MeshBuilder.CreateGround(
    'raid causeway',
    { width: RAID_ROAD_WIDTH, height: length },
    scene,
  );
  const road = raidMaterial(scene, 'warm flagstone paving', '#c0997e');
  const paving = new Texture('./assets/polyhaven/cobblestone_floor_001_diff_1k.webp', scene);
  paving.uScale = RAID_ROAD_WIDTH / (grid.width * 2);
  paving.vScale = rows / 2;
  road.diffuseTexture = paving;
  ground.material = road;

  const lines: Vector3[][] = [];
  for (let col = 1; col < grid.columns; col++) {
    const x = -halfRoad + col * grid.width;
    lines.push([new Vector3(x, 0, -length / 2), new Vector3(x, 0, length / 2)]);
  }
  for (let i = 0; i <= rows; i++) {
    const z = -length / 2 + i * grid.depth;
    lines.push([new Vector3(-halfRoad, 0, z), new Vector3(halfRoad, 0, z)]);
  }
  const joints = MeshBuilder.CreateLineSystem('pavement joints', { lines }, scene);
  joints.parent = ground;
  joints.position.y = 0.012;
  joints.color = Color3.FromHexString('#594a36');
  joints.alpha = 0.13;
  joints.isPickable = false;

  const { rails, gate } = bridgeStonework(scene);
  const { falls, streaks } = canyonFalls(scene);
  const pieces = [rails, canyonBank(scene), falls];
  // Instance whole sections, including the two banks, instead of individual stones or posts.
  const sections = [
    pieces,
    ...[1, 2, 3].map((i) => pieces.map((piece) => piece.createInstance(piece.name + i))),
  ];
  return {
    ground,
    update(runnerZ: number, tick: number) {
      const origin = raidElectricRowZ(0, tick);
      const relative = runnerZ - origin;
      // Two grid rows are one texture repeat. Recentring preserves both pavement and damage cells.
      const row = 2 * Math.floor(relative / (2 * grid.depth)) + 8;
      ground.position.z = raidElectricRowZ(row, tick);
      const first = Math.floor(relative / spanLength) - 1;
      for (let i = 0; i < sections.length; i++) {
        const z = origin + (first + i) * spanLength;
        for (const part of sections[i]!) part.position.z = z;
      }
      gate.position.z = runnerZ + 69;
      streaks.vOffset = (-(tick / RAID_HZ) * 0.59) % 1;
    },
  };
}
