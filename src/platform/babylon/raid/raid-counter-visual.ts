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
    uniform float age, seed, strength;
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
      float d, fade, pool;
      if (upright > 0.5) {
        float h = coord.y;
        float trunk = 0.32 * jag(h * 9.0, frame) + 0.09 * jag(h * 19.0, frame + 15.0);
        trunk *= min(h * 5.0, 1.0);
        float branch = abs(p.x - trunk - (0.52 - h) * 0.95 - 0.11 * jag(h * 18.0, frame + 3.0));
        d = min(abs(p.x - trunk), h > 0.18 && h < 0.52 ? branch * 1.7 : 2.0);
        fade = 1.0 - smoothstep(0.78, 1.0, h);
        pool = 0.0;
      } else {
        float radius = length(p * vec2(1.0, 1.17));
        pool = 0.75 * exp(-5.5 * radius * radius) + 0.28 * exp(-15.0 * abs(radius - 0.52));
        float arc = 0.52 * jag(p.x * 5.0, frame) + 0.16 * jag(p.x * 11.0, frame + 2.0);
        float fork = abs(p.y - arc - 0.56 * (p.x + 0.12) - 0.1 * jag(p.x * 13.0, frame + 8.0));
        d = min(abs(p.y - arc), p.x > -0.12 ? fork * 1.5 : 2.0);
        fade = 1.0 - smoothstep(0.64, 1.0, radius);
      }
      float glow = exp(-9.0 * d), core = exp(-42.0 * d);
      float discharge = smoothstep(0.60, 0.92, strength);
      vec3 glowLight = glowColor * (pool + glow * mix(0.35, 1.0, discharge));
      vec3 coreLight = coreColor * (core * mix(0.23, 1.0, discharge) + 0.28 * pool);
      gl_FragColor = vec4((glowLight + coreLight) * fade, strength);
    }`,
};

function electricTile(scene: Scene, index: number) {
  const { width, depth } = RAID_ELECTRIC_GRID;
  const root = new TransformNode('wagon electric cell ' + index, scene);
  const material = new ShaderMaterial('wagon electricity ' + index, scene, electricShader, {
    attributes: ['position', 'normal', 'uv'],
    uniforms: ['worldViewProjection', 'age', 'seed', 'strength', 'glowColor', 'coreColor'],
    needAlphaBlending: true,
  });
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
    { width: width * 0.52, height: 5.8 },
    scene,
  );
  pillar.position.y = 2.9;
  for (const mesh of [floor, pillar]) {
    mesh.parent = root;
    mesh.material = material;
    mesh.isPickable = false;
  }
  return { root, pillar, material };
}

export function createRaidCounterVisual(scene: Scene) {
  const tiles: ReturnType<typeof electricTile>[] = [];
  return (counter: RaidCounter | null, subtick: number) => {
    const count = counter?.cells.length ?? 0;
    for (let i = count; i < tiles.length; i++) tiles[i]!.root.setEnabled(false);
    if (!counter) return;
    const timing = RAID_COUNTERS[counter.kind];
    const palette = counter.zigzag ? zigzag : straight;
    for (const [i, cell] of counter.cells.entries()) {
      const tile = (tiles[i] ??= electricTile(scene, i));
      tile.root.setEnabled(true);
      tile.root.position.set(cell.x, 0, cell.z - raidRoadTravel(subtick));
      const strike = cell.phase === 'impact';
      tile.pillar.setEnabled(strike && counter.kind === 'pillar');
      const elapsed = (strike ? timing.active : timing.windup) - cell.ticks + subtick;
      // The final two impact ticks leave a softer arc on the same hazardous cell.
      const strength = strike
        ? 0.72 + 0.22 * Math.min(1, (cell.ticks - subtick) / 2)
        : 0.31 + 0.29 * Math.min(1, elapsed / timing.windup);
      tile.material.setColor3('glowColor', palette.glow);
      tile.material.setColor3('coreColor', palette.core);
      tile.material.setFloat('strength', strength);
      tile.material.setFloat('age', elapsed + (strike ? timing.windup : 0));
      tile.material.setFloat('seed', cell.row * 5 + cell.column * 13);
    }
  };
}
