import {
  Color3,
  Mesh,
  StandardMaterial,
  TransformNode,
  VertexData,
  type Scene,
} from '@babylonjs/core';

/** A bowed blade of light with a white leading edge and a translucent wake. Unit half-width is one metre. */
export function createBladeWave(scene: Scene, name: string, color: Color3) {
  const mesh = new Mesh(name, scene);
  const ink = new StandardMaterial(name + ' light', scene);
  ink.disableLighting = true;
  ink.emissiveColor = Color3.White();
  ink.backFaceCulling = false;
  ink.disableDepthWrite = true;
  const data = new VertexData();
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = i / 12 - 1;
    const width = 1 - x * x;
    for (const edge of [0, 0.78, 1]) {
      positions.push(x, 0, width * (edge - 0.3));
      const bright = edge === 1 ? 1 : 0;
      colors.push(
        color.r + (1 - color.r) * bright,
        color.g + (1 - color.g) * bright,
        color.b + (1 - color.b) * bright,
        edge === 0 ? 0 : 0.93,
      );
    }
    if (i)
      for (const offset of [0, 1]) {
        const v = i * 3 + offset;
        indices.push(v - 3, v, v - 2, v - 2, v, v + 1);
      }
  }
  data.positions = positions;
  data.colors = colors;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.material = ink;
  mesh.hasVertexAlpha = true;
  mesh.isPickable = false;
  return mesh;
}

export function createFlyingBlade(scene: Scene) {
  const root = new TransformNode('travelling sword wave', scene);
  const blade = createBladeWave(scene, 'sword wave', new Color3(0.53, 0.84, 1));
  const cross = blade.clone('crossing sword wave');
  blade.parent = cross.parent = root;
  cross.rotation.z = Math.PI / 2;
  return {
    hide: () => root.setEnabled(false),
    draw(
      form: 'horizontal' | 'upright' | 'cross',
      x: number,
      z: number,
      yaw: number,
      halfWidth: number,
    ) {
      root.setEnabled(true);
      root.position.set(x, form === 'horizontal' ? 0.36 : 1, z);
      root.rotation.y = yaw;
      blade.rotation.z = form === 'upright' ? Math.PI / 2 : 0;
      blade.scaling.set(halfWidth, 1, 0.8);
      cross.setEnabled(form === 'cross');
      cross.scaling.set(1.1, 1, 0.68);
    },
  };
}
