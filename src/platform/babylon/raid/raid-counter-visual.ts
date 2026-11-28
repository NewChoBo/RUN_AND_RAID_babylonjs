import {
  Color3,
  Constants,
  MeshBuilder,
  ShaderMaterial,
  TransformNode,
  type Scene,
} from '@babylonjs/core';
import {
  RAID_COUNTERS,
  RAID_ELECTRIC_GRID,
  type RaidCounter,
} from '../../../game/raid/raid-boss.ts';
import { raidRoadTravel } from '../../../game/raid/runner-motion.ts';

const straight = { glow: new Color3(0.12, 0.48, 1), core: new Color3(0.78, 0.96, 1) };
const zigzag = { glow: new Color3(0.4, 0.83, 0.07), core: new Color3(1, 1, 0.6) };
const pillarHeight = 5.8;

const electricShader = {
  vertexSource: `
    precision highp float;
    attribute vec3 position, normal;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    varying vec2 coord;
    varying float upright;
    void main() {
      coord = uv;
      upright = 1.0 - abs(normal.y);
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }`,
  fragmentSource: `
    precision highp float;
    varying vec2 coord;
    varying float upright;
    uniform float age, seed, strength, pillarWave, groundAspect;
    uniform vec3 glowColor, coreColor;

    float hash(float x) { return fract(sin(x * 12.9898 + seed) * 4375.17); }
    // Piecewise linear segments keep the discharge angular even when it spans only a few pixels.
    float jag(float x, float frame) {
      float i = floor(x);
      return mix(hash(i + frame), hash(i + frame + 1.0), fract(x)) - 0.5;
    }
    void main() {
      vec2 p = coord * 2.0 - 1.0;
      float frame = 7.0 * floor(age / 3.0);
      float discharge = smoothstep(0.60, 0.92, strength);
      float d, fade, pool = 0.0;
      vec2 warningLight = vec2(0.78, 0.60);
      if (upright > 0.5) {
        float h = coord.y;
        float trunk = (0.32 * jag(h * 9.0, frame) + 0.09 * jag(h * 19.0, frame + 15.0))
          * min(h * 5.0, 1.0) * mix(0.42, 1.0, discharge);
        d = abs(p.x - trunk);
        if (discharge > 0.0) {
          float fork = abs(p.x - trunk - (0.63 - h) * 1.2 - 0.11 * jag(h * 18.0, frame + 3.0));
          if (h > 0.16 && h < 0.63) d = min(d, fork * 1.5);
          float spur = abs(p.x - trunk + (0.83 - h) * 1.05 + 0.08 * jag(h * 14.0, frame + 7.0));
          if (h > 0.45 && h < 0.83) d = min(d, spur * 1.7);
        }
        fade = 1.0 - smoothstep(0.78, 1.0, h);
      } else if (pillarWave > 0.5) {
        // Only a small point of light touches the road beneath a pillar.
        float r2 = dot(p, p);
        vec3 foot = glowColor * exp(-3.7 * r2) + coreColor * exp(-18.0 * r2);
        gl_FragColor = vec4(foot * (1.0 - smoothstep(0.75, 1.0, r2)), strength);
        return;
      } else {
        // Ground UVs span the rectangular damage cell. Measure the circle in road units.
        p.y *= groundAspect;
        float radius = length(p);
        pool = 0.75 * exp(-5.5 * radius * radius) + 0.28 * exp(-15.0 * abs(radius - 0.52));
        float arc = 0.52 * jag(p.x * 5.0, frame) + 0.16 * jag(p.x * 11.0, frame + 2.0);
        float fork = abs(p.y - arc - 0.56 * (p.x + 0.12) - 0.1 * jag(p.x * 13.0, frame + 8.0));
        d = min(abs(p.y - arc), p.x > -0.12 ? fork * 1.5 : 2.0);
        fade = 1.0 - smoothstep(0.64, 1.0, radius);
        warningLight = vec2(0.35, 0.23);
      }
      float glow = exp(-9.0 * d), core = exp(-42.0 * d);
      vec3 glowLight = glowColor * (pool + glow * mix(warningLight.x, 1.0, discharge));
      vec3 coreLight = coreColor * (0.28 * pool + core * mix(warningLight.y, 1.0, discharge));
      gl_FragColor = vec4((glowLight + coreLight) * fade, strength);
    }`,
};

function electricTile(scene: Scene, index: number) {
  const { width, depth } = RAID_ELECTRIC_GRID;
  const root = new TransformNode('wagon electric cell ' + index, scene);
  const material = new ShaderMaterial('wagon electricity ' + index, scene, electricShader, {
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'worldViewProjection',
      'age',
      'seed',
      'strength',
      'pillarWave',
      'groundAspect',
      'glowColor',
      'coreColor',
    ],
    needAlphaBlending: true,
  });
  material.setFloat('groundAspect', depth / width);
  material.backFaceCulling = false;
  material.disableDepthWrite = true;
  material.alphaMode = Constants.ALPHA_ADD;
  const floor = MeshBuilder.CreateGround(
    'wagon electric pool ' + index,
    { width, height: depth },
    scene,
  );
  floor.position.y = 0.045;
  const pillar = MeshBuilder.CreatePlane(
    'wagon electric pillar ' + index,
    { width: width * 0.52, height: pillarHeight },
    scene,
  );
  for (const mesh of [floor, pillar]) {
    mesh.parent = root;
    mesh.material = material;
    mesh.isPickable = false;
  }
  return { root, floor, pillar, material };
}

function firstPillarWarning(cells: RaidCounter['cells']) {
  let first: (typeof cells)[number] | undefined;
  for (const cell of cells) {
    if (cell.phase === 'impact') return undefined;
    if (!first || cell.ticks < first.ticks) first = cell;
  }
  return first?.row;
}

export function createRaidCounterVisual(scene: Scene) {
  const tiles: ReturnType<typeof electricTile>[] = [];
  return (counter: RaidCounter | null, subtick: number) => {
    if (!counter) {
      for (const tile of tiles) tile.root.setEnabled(false);
      return;
    }
    const timing = RAID_COUNTERS[counter.kind];
    const palette = counter.zigzag ? zigzag : straight;
    const pillar = counter.kind === 'pillar';
    const warningRow = pillar ? firstPillarWarning(counter.cells) : undefined;
    let count = 0;
    for (const cell of counter.cells) {
      const strike = cell.phase === 'impact';
      if (pillar && !strike && cell.row !== warningRow) continue;
      const i = count++;
      const tile = (tiles[i] ??= electricTile(scene, i));
      tile.root.setEnabled(true);
      tile.root.position.set(cell.x, 0, cell.z - raidRoadTravel(subtick));
      const elapsed = (strike ? timing.active : timing.windup) - cell.ticks + subtick;
      tile.floor.scaling.set(pillar ? 0.34 : 1, 1, pillar ? 0.28 : 1);
      tile.pillar.setEnabled(pillar);
      if (pillar) {
        const heightScale = strike ? 1 : 0.48 + 0.16 * (elapsed / timing.windup);
        tile.pillar.scaling.set(strike ? 1 : 0.6, heightScale, 1);
        tile.pillar.position.y = tile.floor.position.y + (pillarHeight * heightScale) / 2;
      }
      // The final two impact ticks leave a softer arc on the same hazardous cell.
      const strength = strike
        ? 0.72 + 0.22 * Math.min(1, (cell.ticks - subtick) / 2)
        : 0.31 + 0.29 * Math.min(1, elapsed / timing.windup);
      tile.material.setColor3('glowColor', palette.glow);
      tile.material.setColor3('coreColor', palette.core);
      tile.material.setFloat('pillarWave', pillar ? 1 : 0);
      tile.material.setFloat('strength', strength);
      tile.material.setFloat('age', elapsed + (strike ? timing.windup : 0));
      tile.material.setFloat('seed', cell.row * 5 + cell.column * 13);
    }
    for (let i = count; i < tiles.length; i++) tiles[i]!.root.setEnabled(false);
  };
}
