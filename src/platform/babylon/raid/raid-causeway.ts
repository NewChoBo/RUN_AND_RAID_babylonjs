import {
  Color3,
  Curve3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  type Scene,
  Texture,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import { RAID_ELECTRIC_GRID, raidElectricRowZ } from '../../../game/raid/raid-boss.ts';
import { RAID_HZ, RAID_ROAD_WIDTH } from '../../../game/raid/raid-rules.ts';
import { raidMaterial } from './raid-material.ts';

// One repeat covers both banks. The rock profile meets its neighbour at either end.
const spanLength = 72;
const halfRoad = RAID_ROAD_WIDTH / 2;

// Steep faces alternate with narrow, weathered shelves above the ravine floor.
const bankX = [11.8, 15.8, 14.9, 17.1, 16.2, 19.8, 19.1, 25, 32];
const bankY = [-7.5, -2.5, 1.8, 3.5, 7.8, 9.1, 14.4, 15.2, 11.8];
const fallsAt = (side: number) => (side < 0 ? 16 : 26);

function bankPoint(side: number, z: number, ledge: number) {
  const turn = (2 * Math.PI * z) / spanLength;
  const shift = side * 1.9 + ledge * 0.12;
  const broad = Math.sin(turn * 2 + shift);
  const fracture = Math.abs(Math.sin(turn * 5 + side + ledge * 0.08));
  const ridge = Math.sin(turn * 3 + side) + Math.cos(turn * 7 - shift) * 0.32;
  return new Vector3(
    side * (bankX[ledge]! + broad * 2.5 + fracture * 1.45),
    bankY[ledge]! + ridge * (0.85 + ledge * 0.3) + broad * 1.6,
    z,
  );
}

// The water spills over a rock lip in front of the lower shelves.
function waterfallLip(side: number) {
  const z = fallsAt(side);
  const lip = bankPoint(side, z, 5);
  lip.x = bankPoint(side, z, 2).x - side * 1.15;
  return lip;
}

function canyonBank(scene: Scene) {
  const positions: number[] = [],
    indices: number[] = [],
    colors: number[] = [],
    uvs: number[] = [];
  const ledges = bankX.length;
  const steps = 48;
  const bankStarts: number[] = [];
  const mossByLedge = [0.05, 0.12, 0.56, 0.85, 0.24, 0.83, 0.31, 0.68, 0.42];
  function vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    shade: number,
    moss: number,
  ) {
    positions.push(x, y, z);
    uvs.push(u, v);
    colors.push(
      shade * (1 - moss * 0.39),
      shade * (0.95 + moss * 0.05),
      shade * (0.9 - moss * 0.34),
      1,
    );
  }
  // Split boulders jut out from the wall. Their mossy crowns overhang a darker seam.
  function outcrop(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    seed: number,
  ) {
    const sides = 7;
    const first = positions.length / 3;
    const rings = [
      [0.74, -1],
      [0.96, -0.27],
      [1.05, -0.16],
      [0.91, 0],
    ] as const;
    for (const [ring, [radius, level]] of rings.entries()) {
      for (let j = 0; j <= sides; j++) {
        const angle = ((j % sides) / sides) * 2 * Math.PI + seed;
        const edge = 1 + Math.sin(angle * 3 + seed) * 0.16;
        const px = x + width * radius * edge * Math.cos(angle);
        const pz = z + depth * radius * edge * Math.sin(angle);
        const py = y + height * level + Math.cos(2 * angle + seed) * height * 0.075;
        const moss = ring < 2 ? 0.12 : 0.55 + Math.cos(angle * 2 - seed) * 0.31;
        const shade = [0.61, 0.68, 0.9, 1][ring]!;
        vertex(px, py, pz, (j / sides) * (width + depth) * 0.52, py / 4, shade, moss);
        if (j && ring) {
          const d = positions.length / 3 - 1,
            a = d - sides - 2;
          indices.push(a, a + 1, d - 1, a + 1, d, d - 1);
        }
      }
    }
    // Separate top vertices retain a clean cliff edge and planar crown texture.
    const rim = positions.length / 3;
    for (let j = 0; j < sides; j++) {
      const k = (first + 3 * (sides + 1) + j) * 3;
      const px = positions[k]!,
        py = positions[k + 1]!,
        pz = positions[k + 2]!;
      vertex(px, py, pz, px / 4, pz / 4, 1, 0.92);
    }
    const center = positions.length / 3;
    vertex(x, y + height * 0.08, z, x / 4, z / 4, 0.94, 0.76);
    for (let j = 0; j < sides; j++) indices.push(rim + j, rim + ((j + 1) % sides), center);
  }

  for (const side of [-1, 1]) {
    const first = positions.length / 3;
    bankStarts.push(first);
    for (let step = 0; step <= steps; step++) {
      const z = (step / steps - 0.5) * spanLength;
      for (let ledge = 0; ledge < ledges; ledge++) {
        const v = bankPoint(side, z, ledge);
        const turn = (z * 2 * Math.PI) / spanLength;
        const moss = mossByLedge[ledge]! * (0.73 + 0.27 * Math.sin(turn * 3 + side));
        const shade = 0.91 + 0.09 * Math.cos(turn * 5 + side + ledge);
        vertex(v.x, v.y, v.z, z / 6, (Math.abs(v.x) + v.y) / 6, shade, moss);
        if (step === 0 || ledge === 0) continue;
        const d = first + step * ledges + ledge;
        const a = d - ledges - 1,
          b = d - ledges,
          c = d - 1;
        if (side > 0) indices.push(a, b, c, b, d, c);
        else indices.push(a, c, b, b, c, d);
      }
    }
    for (let i = 0; i < 8; i++) {
      const seed = i * 4.37 + side;
      const z = -30 + i * 8.4 + Math.sin(seed) * 1.3;
      if (Math.abs(z - fallsAt(side)) < 6) continue;
      const ledge = i % 3 === 0 ? 6 : i % 3 === 1 ? 3 : 5;
      const v = bankPoint(side, z, ledge);
      outcrop(
        v.x,
        v.y + 0.8,
        z,
        3.6 + Math.cos(seed),
        4.2 + Math.sin(seed),
        4.1 + ledge * 0.5,
        seed,
      );
    }
    const lip = waterfallLip(side);
    outcrop(lip.x + side * 3.5, lip.y - 0.35, lip.z, 3.9, 4.8, 6.8, side * 2);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  // Duplicate boundary vertices keep the UV repeat and share a normal with the next section.
  for (const first of bankStarts) {
    for (let ledge = 0; ledge < ledges; ledge++) {
      const a = (first + ledge) * 3;
      const b = a + steps * ledges * 3;
      const normal = Vector3.FromArray(normals, a)
        .addInPlace(Vector3.FromArray(normals, b))
        .normalize();
      normal.toArray(normals, a);
      normal.toArray(normals, b);
    }
  }
  const data = new VertexData();
  Object.assign(data, { positions, indices, normals, uvs, colors });
  const bank = new Mesh('sunlit canyon banks', scene);
  data.applyToMesh(bank);
  const material = raidMaterial(scene, 'weathered canyon walls', '#efe4cf');
  material.diffuseTexture = new Texture('./assets/raid/environment/canyon-rock.webp', scene);
  material.specularColor = new Color3(0.04, 0.04, 0.03);
  bank.material = material;
  bank.isPickable = false;
  return bank;
}

function bridgeStonework(scene: Scene) {
  const material = raidMaterial(scene, 'rust sandstone', '#bba18c');
  material.diffuseTexture = new Texture('./assets/polyhaven/rock_pitted_mossy_diff_1k.webp', scene);
  const box = VertexData.CreateBox({ size: 1 });
  const throughIndices = Array.from(box.indices!).filter(
    (index) => Math.abs(box.normals![index * 3 + 2]!) < 0.5,
  );
  let positions: number[] = [],
    indices: number[] = [],
    colors: number[] = [],
    uvs: number[] = [];
  // Build masonry directly into a single buffer per structure. Tapered blocks make splayed
  // capitals; a difference in end heights carries the moulding up into each pedestal.
  function stone(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    shade: number,
    taper = 1,
    rise = 0,
    openEnds = false,
  ) {
    const first = positions.length / 3;
    for (let i = 0; i < box.positions!.length; i += 3) {
      const scale = box.positions![i + 1]! > 0 ? taper : 1;
      const px = x + box.positions![i]! * w * scale;
      const pz = z + box.positions![i + 2]! * d * scale;
      const py = y + box.positions![i + 1]! * h + box.positions![i + 2]! * rise;
      positions.push(px, py, pz);
      const alongX = Math.abs(box.normals![i]!) > 0.5;
      const horizontal = Math.abs(box.normals![i + 1]!) > 0.5;
      uvs.push((alongX ? pz : px) / 3.2, (horizontal ? pz : py) / 3.2);
      colors.push(shade, shade, shade, 1);
    }
    for (const i of openEnds ? throughIndices : box.indices!) indices.push(first + i);
  }
  function finish(name: string) {
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    Object.assign(data, { positions, indices, normals, uvs, colors });
    const result = new Mesh(name, scene);
    data.applyToMesh(result);
    result.material = material;
    result.isPickable = false;
    positions = [];
    indices = [];
    colors = [];
    uvs = [];
    return result;
  }
  const stops = [
    [0, 0],
    [3.45, 0],
    [4.75, 0.35],
    [7.25, 0.35],
    [8.55, 0],
    [12, 0],
  ] as const;
  for (const side of [-1, 1]) {
    const x = side * (halfRoad + 0.42);
    stone(x, -0.48, 0, 1.05, 1.7, spanLength, 0.72, 1, 0, true);
    stone(x, 0.22, 0, 1.15, 0.29, spanLength, 0.88, 0.91, 0, true);
    for (let bay = 0; bay < 6; bay++) {
      const start = -spanLength / 2 + bay * 12;
      for (let i = 1; i < stops.length; i++) {
        const [from, low] = stops[i - 1]!,
          [to, high] = stops[i]!;
        const z = start + (from + to) / 2;
        const level = (low + high) / 2,
          rise = high - low,
          length = to - from;
        stone(x, 0.52 + level, z, 0.81, 0.64, length, 0.78, 1, rise, true);
        stone(x, 0.83 + level, z, 0.96, 0.13, length, 0.98, 1, rise, true);
        stone(x, 0.94 + level, z, 0.85, 0.095, length, 0.9, 1, rise, true);
      }
      const z = start + 6;
      stone(x, 0.72, z, 1.29, 1.44, 1.52, 0.89, 0.88);
      stone(x, 1.15, z, 1.37, 0.2, 1.56, 0.75, 1.1);
      stone(x, 1.43, z, 1.22, 0.36, 1.48, 0.94, 1.2);
      stone(x, 1.64, z, 1.6, 0.13, 1.89, 0.8);
      stone(x, 2.06, z, 1.49, 0.71, 1.82, 0.96);
      stone(x, 2.44, z, 1.54, 0.07, 1.87, 1);
      // Every other parapet post backs onto a tall pier rooted below the bridge deck.
      if (bay % 2 === 0) {
        const pierX = side * (halfRoad + 2.1);
        stone(pierX, -2.5, z, 3.2, 6, 3.6, 0.77, 0.94);
        stone(pierX, 0.65, z, 2.98, 0.3, 3.25, 0.9);
        stone(pierX, 3.8, z, 2.45, 6, 2.7, 0.84, 0.88);
        stone(pierX, 7.3, z, 2.28, 1, 2.63, 0.94, 1.55);
        stone(pierX, 7.9, z, 3.64, 0.2, 4.18, 1);
      }
    }
  }
  const rails = finish('moulded stone parapets');
  for (const side of [-1, 1]) {
    stone(side * 5, 3.1, 0, 1.65, 6.2, 2.8, 0.84);
    stone(side * 5, 5.85, 0, 1.75, 0.78, 2.86, 0.9, 1.4);
  }
  stone(0, 6.57, 0, 12.6, 0.84, 2.65, 0.86);
  stone(0, 7.05, 0, 13, 0.15, 2.91, 0.97);
  return { rails, gate: finish('distant canyon gate') };
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
      const eddy = noise(u * 5, v, 9);
      const flow = u + 0.16 * (eddy - 0.5);
      const stream = noise(flow * 11, v, 8);
      const spray = noise(flow * 31, v, 24);
      const foam = Math.max(0, Math.min(1, (0.61 * stream + 0.39 * spray - 0.38) * 3.2));
      const edge = Math.max(0, Math.min(1, (0.5 - Math.abs(u - 0.5)) * 14 - 1.6 * eddy));
      const breakup = Math.max(0, Math.min(1, (stream + 0.48 * spray - 0.27) * 2.6));
      const i = (y * 128 + x) * 4;
      pixels.data.set(
        [179 + 76 * foam, 197 + 58 * foam, 199 + 56 * foam, edge * breakup * (158 + 97 * foam)],
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
    const lip = waterfallLip(side);
    // A broader broken sheet from the main shelf, with one thinner stream in the adjacent cleft.
    for (const strand of [0, 1]) {
      const halfWidth = strand ? 0.55 : side < 0 ? 3.2 : 2.1;
      const z = lip.z + (strand ? side * 4.7 : 0);
      const top = lip.y - (strand ? 1.28 : 0);
      const profile = [
        [0.65, 0, 0.72],
        [-0.37, -0.48, 0.94],
        [-0.9, -1.6, 1],
        [-1.03, -top * 0.65, 1.04],
        [-1.5, -top - 4, 1.13],
      ] as const;
      const edges = [-1, -0.5, 0, 0.5, 1].map((edge) =>
        Curve3.CreateCatmullRomSpline(
          profile.map(
            ([offset, drop, width]) =>
              new Vector3(
                lip.x +
                  side *
                    (offset +
                      (strand ? 0.8 : 0) -
                      edge * halfWidth * 0.42 +
                      Math.sin(edge * 5 + side) * 0.12),
                top + drop,
                z + edge * width * halfWidth,
              ),
          ),
          3,
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
    ...[1, 2, 3].map((i) =>
      pieces.map((piece) => {
        const instance = piece.createInstance(piece.name + i);
        instance.isPickable = false;
        return instance;
      }),
    ),
  ];
  return {
    ground,
    gate,
    update(runnerZ: number, tick: number) {
      const origin = raidElectricRowZ(0, tick);
      const relative = runnerZ - origin;
      // Two grid rows are one texture repeat. Recentring preserves both pavement and damage cells.
      const row = 2 * Math.floor(relative / (2 * grid.depth)) + 8;
      ground.position.z = raidElectricRowZ(row, tick);
      // Keep the visible sections on their road coordinates. Only recycle beyond the camera.
      const first = Math.floor(relative / spanLength + 0.5) - 1;
      for (let i = 0; i < sections.length; i++) {
        const span = first + i;
        const slot = ((span % sections.length) + sections.length) % sections.length;
        const z = origin + span * spanLength;
        for (const part of sections[slot]!) part.position.z = z;
      }
      streaks.vOffset = (-(tick / RAID_HZ) * 0.59) % 1;
    },
  };
}
