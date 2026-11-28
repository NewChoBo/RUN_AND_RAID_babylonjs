"""Restore the demon outfit's original split Skin weights on its assembled mesh."""

from collections import defaultdict


def uv_keys(mesh):
    uvs = mesh.uv_layers.active.data
    keys = [set() for _ in mesh.vertices]
    for loop in mesh.loops:
        keys[loop.vertex_index].add(tuple(round(v, 5) for v in uvs[loop.index].uv))
    return [tuple(sorted(key)) for key in keys]


def restore_drizz_skin(base, scenes):
    import bpy

    bpy.context.window.scene = base
    mesh = next(o for o in base.objects if o.type == "MESH")
    world = mesh.matrix_world.copy()
    positions = [world @ v.co for v in mesh.data.vertices]
    by_uv = defaultdict(list)
    for i, key in enumerate(uv_keys(mesh.data)):
        by_uv[key].append(i)
    weights = {}
    parts = []
    # Some UV seams duplicate vertices. They must agree on all original weights.
    # The assembled shell and the split bind meshes differ along Blender's Y axis.
    for suffix in ("body", "righthand"):
        scene = scenes[f"drizz/drizz#demon#{suffix}.max"]
        bpy.context.window.scene = scene
        scene.frame_set(scene.frame_start)
        part = next(o for o in scene.objects if o.type == "MESH" and o.find_armature())
        indices = []
        for v, key in zip(part.data.vertices, uv_keys(part.data), strict=True):
            p = part.matrix_world @ v.co
            matches = [
                i for i in by_uv[key]
                if abs(p.x - positions[i].x) < 1e-5 and abs(p.z - positions[i].z) < 1e-5
            ]
            if not matches:
                raise ValueError(f"Missing assembled vertex for {part.name}/{v.index}")
            original = {
                part.vertex_groups[g.group].name: g.weight for g in v.groups if g.weight > 0
            }
            for i in matches:
                if i in weights and weights[i] != original:
                    raise ValueError(f"Conflicting Drizz weights at assembled vertex {i}")
                weights[i] = original
            indices.append(matches)
        parts.append((scene, part, indices))
    if len(weights) != len(positions):
        raise ValueError("Incomplete Drizz skin")

    # Drizz's combined default rig contains both the body and the independent hand bones.
    rig_scene = scenes["drizz/drizz#default.max"]
    bpy.context.window.scene = rig_scene
    rig_scene.frame_set(rig_scene.frame_start)
    rig = next(
        o.find_armature() for o in rig_scene.objects if o.type == "MESH" and o.find_armature()
    )
    target = rig.copy()
    target.parent = None
    target.matrix_world = rig.matrix_world.copy()
    base.collection.objects.link(target)
    bpy.context.window.scene = base
    names = sorted({n for group in weights.values() for n in group})
    if any(n not in target.data.bones for n in names):
        raise ValueError("Missing Drizz bind bone")
    groups = {n: mesh.vertex_groups.new(name=n) for n in names}
    for i, group in weights.items():
        for name, weight in group.items():
            groups[name].add([i], weight, "REPLACE")
    mesh.parent = target
    mesh.matrix_world = world
    mesh.modifiers.new("Skin", "ARMATURE").object = target
    bpy.context.view_layer.update()
    return parts
