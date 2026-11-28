import { Mesh, VertexBuffer, VertexData, type Scene } from '@babylonjs/core';
import type { RaidHero } from '../../../game/raid/heroes/hero-id.ts';

/** Both battle skins contain the separately authored right hand, rigidly weighted to these bones. */
function copyHand(body: Mesh) {
  const handBones = new Set(
    body
      .skeleton!.bones.filter((bone) => bone.name === 'Rhand_bn' || bone.name.startsWith('Rfinger'))
      .map((bone) => bone.getIndex()),
  );
  const joints = body.getVerticesData(VertexBuffer.MatricesIndicesKind);
  const weights = body.getVerticesData(VertexBuffer.MatricesWeightsKind);
  const positions = body.getVerticesData(VertexBuffer.PositionKind);
  const normals = body.getVerticesData(VertexBuffer.NormalKind);
  const uvs = body.getVerticesData(VertexBuffer.UVKind);
  const indices = body.getIndices();
  if (!joints || !weights || !positions || !normals || !uvs || !indices || !handBones.size) return;

  const vertices = new VertexData();
  const remap = new Map<number, number>();
  const points: number[] = [],
    directions: number[] = [],
    texture: number[] = [],
    faces: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) {
    if (weights[4 * i]! < 0.5 || !handBones.has(joints[4 * i]!)) continue;
    remap.set(i, remap.size);
    points.push(positions[3 * i]!, positions[3 * i + 1]!, positions[3 * i + 2]!);
    directions.push(normals[3 * i]!, normals[3 * i + 1]!, normals[3 * i + 2]!);
    texture.push(uvs[2 * i]!, uvs[2 * i + 1]!);
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = remap.get(indices[i]!),
      b = remap.get(indices[i + 1]!),
      c = remap.get(indices[i + 2]!);
    if (a !== undefined && b !== undefined && c !== undefined) faces.push(a, b, c);
  }
  if (!faces.length) return;
  vertices.positions = points;
  vertices.normals = directions;
  vertices.uvs = texture;
  vertices.indices = faces;
  const mesh = new Mesh('Drizz flying hand', body.getScene());
  vertices.applyToMesh(mesh);
  mesh.material = body.material;
  mesh.isPickable = false;
  const center = mesh.getBoundingInfo().boundingBox.center;
  mesh.position.copyFrom(center).negateInPlace();
  mesh.bakeCurrentTransformIntoVertices();
  // Place the fingertips forward. The hand hangs down in the original bind pose.
  mesh.rotation.x = -Math.PI / 2;
  mesh.bakeCurrentTransformIntoVertices();
  return mesh;
}

export function createDrizzHand(scene: Scene) {
  let body: Mesh | undefined, hand: Mesh | undefined;
  let owner: RaidHero | undefined;
  return {
    hide() {
      hand?.setEnabled(false);
    },
    draw(hero: RaidHero, x: number, z: number, yaw: number) {
      if (hero !== owner || !body || body.isDisposed()) {
        hand?.dispose();
        owner = hero;
        body = scene
          .getTransformNodeByName(hero + ' facing')
          ?.getChildMeshes()
          .find((part): part is Mesh => part instanceof Mesh && !!part.skeleton);
        hand = body && copyHand(body);
      }
      if (!hand) return false;
      hand.setEnabled(true);
      hand.position.set(x, 1, z);
      hand.rotation.y = yaw;
      return true;
    },
  };
}
