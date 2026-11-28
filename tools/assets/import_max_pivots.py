"""Import one original Max scene's sampled pivots into the currently open Blender scene.

In Blender 5.3, open the desired scene in a native-edit group .blend, open this
script in the Text Editor, and press Run Script. Nothing runs on opening a .blend.
Use Save As to keep a personally editable copy.
"""

import gzip
import json
import re
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix


def source_id(scene):
    source_sha = scene.get("source_sha256") or scene.get("source_max_sha256")
    if not isinstance(source_sha, str) or not re.fullmatch(
        "[0-9a-fA-F]{64}", source_sha
    ):
        raise ValueError("Choose a scene that has its original MAX source SHA-256.")
    return source_sha.lower()


def source_paths(source_sha, native_dir):
    if native_dir is None:
        if not bpy.data.filepath:
            raise ValueError("Open the unpacked group .blend first.")
        dirs = [
            folder / "native" for folder in Path(bpy.data.filepath).resolve().parents
        ]
    else:
        dirs = [Path(native_dir).resolve()]
    for native in dirs:
        stem = native / "scenes" / source_sha.lower()
        meta, frames = stem.with_suffix(".json.gz"), stem.with_suffix(".f32.gz")
        if meta.is_file() and frames.is_file():
            return meta, frames
    raise FileNotFoundError(
        "Unpack native/scenes beside native-edit, or supply native_dir."
    )


def rotations(matrices):
    values = []
    previous = None
    for matrix in matrices:
        q = Matrix(matrix.tolist()).to_quaternion().normalized()
        if previous is not None:
            q.make_compatible(previous)
        values.append(list(q))
        previous = q
    return np.asarray(values)


def factors(linear):
    """Return proper left and optional right rotation, with mirror sign in scale."""
    sizes = np.linalg.norm(linear, axis=1)
    if np.all(sizes > 1e-9):
        axes = linear / sizes[:, None, :]
        orthogonality = np.swapaxes(axes, 1, 2) @ axes - np.eye(3)
        if np.max(np.abs(orthogonality)) <= 1e-6:
            sign = np.where(np.linalg.det(axes) < 0, -1.0, 1.0)
            axes[:, :, 0] *= sign[:, None]
            sizes[:, 0] *= sign
            return rotations(axes), sizes, None
    # Blender has no single shear channel. Two proper rotations around a diagonal
    # signed scale reproduce the sampled affine transform, including singular ones.
    left, scale, right = np.linalg.svd(linear)
    left_sign = np.where(np.linalg.det(left) < 0, -1.0, 1.0)
    right_sign = np.where(np.linalg.det(right) < 0, -1.0, 1.0)
    left[:, :, -1] *= left_sign[:, None]
    right[:, -1, :] *= right_sign[:, None]
    scale[:, -1] *= left_sign * right_sign
    return rotations(left), scale, rotations(right)


def animate(obj, frames, tracks, created):
    # Constant transforms remain ordinary editable object properties.
    channels = []
    for name, values in tracks.items():
        setattr(obj, name, values[0])
        for index, component in enumerate(values.T):
            if np.any(component != component[0]):
                channels.append((name, index, component))
    if not channels:
        return
    action = bpy.data.actions.new(obj.name)
    created.append(action)
    slot = action.slots.new("OBJECT", obj.name)
    strip = action.layers.new("Original Max frames").strips.new(type="KEYFRAME")
    bag = strip.channelbag(slot, ensure=True)
    for name, index, component in channels:
        curve = bag.fcurves.new(data_path=name, index=index)
        points = curve.keyframe_points
        points.add(len(frames))
        packed = np.column_stack((frames, component)).astype(np.float32).ravel()
        points.foreach_set("co", packed)
        for point in points:
            point.interpolation = "LINEAR"
        curve.update()
    anim = obj.animation_data_create()
    anim.action, anim.action_slot = action, slot


def local_samples(world, parents, index):
    parent = parents[index]
    if parent is None:
        return None, world[:, index]
    try:
        # Solve instead of inverting the entire armature at every playback frame.
        return parent, np.linalg.solve(world[:, parent], world[:, index])
    except np.linalg.LinAlgError:
        # A zero-scale parent has no unique local inverse.
        return None, world[:, index]


def import_pivots(scene=None, native_dir=None):
    scene = scene or bpy.context.scene
    source_sha = source_id(scene)
    for coll in scene.collection.children:
        if coll.get("max_pivot_source") == source_sha:
            print("Keeping the existing editable pivot collection:", coll.name)
            return coll
    meta_path, frames_path = source_paths(source_sha, native_dir)
    with gzip.open(meta_path, "rt", encoding="utf8") as stream:
        meta = json.load(stream)
    if meta["sha256"] != source_sha:
        raise ValueError("Native inventory belongs to a different MAX file.")
    nodes = meta["nodes"]
    time = meta["timing"]
    frames = np.arange(time["first"], time["last"] + 1, dtype=np.int32)
    with gzip.open(frames_path, "rb") as stream:
        raw = np.frombuffer(stream.read(), dtype="<f4").reshape(
            len(frames), len(nodes), 4, 3
        )
    if not len(frames) or not np.isfinite(raw).all():
        raise ValueError("Invalid native matrix samples.")
    # Max stores its 3x3 basis in rows and translation in row four. Both tools
    # use a right-handed Z-up world. Convert the position from native units once.
    world = np.zeros((len(frames), len(nodes), 4, 4), dtype=np.float64)
    world[..., :3, :3] = raw[..., :3, :].swapaxes(-2, -1)
    meter_per_blender_unit = (
        scene.unit_settings.scale_length if scene.unit_settings.system != "NONE" else 1
    )
    units = float(meta["units"]["perMeter"]) * meter_per_blender_unit
    if not np.isfinite(units) or units <= 0:
        raise ValueError("Invalid native or Blender length unit.")
    world[..., :3, 3] = raw[..., 3, :] / units
    world[..., 3, 3] = 1
    by_name = defaultdict(list)
    by_handle = {}
    for i, node in enumerate(nodes):
        by_name[node["name"]].append(i)
        by_handle[node["handle"]] = i
    parents = []
    for node in nodes:
        matches = by_name.get(node["parent"], [])
        parents.append(
            by_handle.get(
                node.get("parentHandle"), matches[0] if len(matches) == 1 else None
            )
        )

    # Build an unlinked collection first, so a failed import leaves user edits intact.
    coll = bpy.data.collections.new("Max pivots - " + scene.name)
    coll["max_pivot_source"] = source_sha
    created = [coll]
    heads, ends, linked_parents = [], [], []
    span = float(np.linalg.norm(np.ptp(world[0, :, :3, 3], axis=0))) if nodes else 1
    size = max(0.008 / meter_per_blender_unit, span * 0.02)

    def empty(name):
        ob = bpy.data.objects.new(name, None)
        created.append(ob)
        coll.objects.link(ob)
        ob.empty_display_type = "ARROWS"
        ob.empty_display_size = size
        ob.rotation_mode = "QUATERNION"
        return ob

    try:
        for i, node in enumerate(nodes):
            parent, local = local_samples(world, parents, i)
            left, scale, right = factors(local[:, :3, :3])
            head = empty(
                node["name"] + (" - scale axes" if right is not None else " - pivot")
            )
            animate(
                head,
                frames,
                {
                    "location": local[:, :3, 3],
                    "rotation_quaternion": left,
                    "scale": scale,
                },
                created,
            )
            pivot = head
            if right is not None:
                head.empty_display_type = "PLAIN_AXES"
                head.empty_display_size = 0.3 * size
                pivot = empty(node["name"] + " - pivot")
                pivot.parent = head
                animate(pivot, frames, {"rotation_quaternion": right}, created)
            pivot["max_node_name"] = node["name"]
            pivot["max_node_handle"] = node["handle"]
            pivot["max_parent_name"] = node["parent"] or ""
            if parent is None and node["parent"]:
                pivot["max_parent_fallback"] = (
                    "World samples (ambiguous name or singular parent)"
                )
            heads.append(head)
            ends.append(pivot)
            linked_parents.append(parent)
        for i, parent in enumerate(linked_parents):
            if parent is not None:
                heads[i].parent = ends[parent]
        scene.collection.children.link(coll)
    except (RuntimeError, ValueError, TypeError, OverflowError):
        bpy.data.batch_remove(ids=created)
        raise

    scene.render.fps = time["fps"]
    scene.render.fps_base = 1
    scene.frame_end = int(frames[-1])
    scene.frame_start = max(0, int(frames[0]))
    if frames[0] < 0 or scene.use_preview_range:
        scene.use_preview_range = True
        scene.frame_preview_end = int(frames[-1])
        scene.frame_preview_start = int(frames[0])
    scene.frame_set(int(frames[0]))
    print(
        f"Imported {len(nodes)} editable pivots, {len(frames)} source frames: {coll.name}"
    )
    return coll


if __name__ == "__main__":
    import_pivots()
