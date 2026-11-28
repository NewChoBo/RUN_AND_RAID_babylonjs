"""Attach a native Max Alembic reference and restore measurable rigid bone motion in each Blender scene."""

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

import bpy
import numpy as np
from library import ROOT, WORK, read_json, save_json
from mathutils import Matrix, Vector
from port_max_faces import restore_faces
from port_max_scenes import pack_referenced_images, separate_bone_geometry
from prepare_motion_reference import fit, rms, transform


def folded(name):
    return re.sub(r"\.\d{3,}$", "", name).casefold()


def world_vertices(obj, graph):
    obj = obj.evaluated_get(graph)
    xyz = np.empty(3 * len(obj.data.vertices), dtype=np.float32)
    obj.data.vertices.foreach_get("co", xyz)
    return transform(np.asarray(obj.matrix_world)[:3], xyz.reshape(-1, 3))


def topology(mesh):
    # Preserve vertex correspondence even if importers start face loops at different corners.
    return sorted(tuple(sorted(p.vertices)) for p in mesh.polygons)


def pair_meshes(editable, original):
    source = defaultdict(list)
    for obj in original:
        if obj.type == "MESH":
            source[len(obj.data.vertices)].append(obj)
    pairs, unmatched = [], []
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in editable:
        if obj.type != "MESH":
            continue
        candidates = source[len(obj.data.vertices)]
        matches = [o for o in candidates if folded(o.name) == folded(obj.name)]
        candidates = matches or candidates
        fingerprint = topology(obj.data)
        matches = [o for o in candidates if topology(o.data) == fingerprint]
        if (
            not matches
            and len(candidates) == 1
            and folded(candidates[0].name) == folded(obj.name)
        ):
            # FBX sometimes triangulates a Max polygon along a different diagonal.
            # Retain vertex IDs if the index topology or an unchanged bind pose proves them.
            native = candidates[0]
            a = {tuple(sorted(edge.vertices)) for edge in obj.data.edges}
            b = {tuple(sorted(edge.vertices)) for edge in native.data.edges}
            current, expected = (world_vertices(o, graph) for o in (obj, native))
            if len(current) and (
                len(a & b) >= max(1, min(len(a), len(b)) * 0.98)
                or np.max(np.linalg.norm(current - expected, axis=1))
                < max(np.linalg.norm(np.ptp(expected, axis=0)), 1e-6) * 0.0001
            ):
                matches = [native]
        if len(matches) != 1:
            unmatched.append(obj.name)
            continue
        actual = matches[0]
        pairs.append((obj, actual))
        source[len(obj.data.vertices)].remove(actual)
        if len(obj.material_slots) and [
            p.material_index for p in obj.data.polygons
        ] == [p.material_index for p in actual.data.polygons]:
            actual.data.materials.clear()
            for slot in obj.material_slots:
                actual.data.materials.append(slot.material)
    return pairs, unmatched


def rigid_indices(obj):
    arm = obj.find_armature()
    by_bone = defaultdict(list)
    if arm is None:
        return by_bone
    names = {g.index: g.name for g in obj.vertex_groups if g.name in arm.pose.bones}
    for vertex in obj.data.vertices:
        for g in vertex.groups:
            if g.weight >= 0.9999 and g.group in names:
                by_bone[names[g.group]].append(vertex.index)
    return {name: np.asarray(ids) for name, ids in by_bone.items() if len(ids) >= 3}


def measure(scene, pairs, frames, discover):
    if not pairs:
        return {}, {}
    groups = {obj: rigid_indices(obj) for obj, _ in pairs} if discover else {}
    maximum = {obj.name: [0.0, 0.0] for obj, _ in pairs}
    fixes = defaultdict(lambda: defaultdict(dict))
    graph = bpy.context.evaluated_depsgraph_get()
    for frame in frames:
        scene.frame_set(frame)
        targets = defaultdict(list)
        for obj, native in pairs:
            current = world_vertices(obj, graph)
            expected = world_vertices(native, graph)
            if current.shape != expected.shape or not len(current):
                raise ValueError(
                    f"Changing vertex correspondence at {obj.name}, frame {frame}"
                )
            delta = current - expected
            span = max(float(np.linalg.norm(np.ptp(expected, axis=0))), 1e-6)
            worst = float(np.max(np.linalg.norm(delta, axis=1))) / span
            entry = maximum[obj.name]
            entry[0] = max(entry[0], worst)
            entry[1] = max(entry[1], rms(delta) / span)
            if discover and worst > 0.001:
                for bone, ids in groups[obj].items():
                    if rms(delta[ids]) > span * 0.00001:
                        targets[obj.find_armature(), bone].append(
                            (current[ids], expected[ids], span)
                        )
        for (arm, bone), anchors in targets.items():
            x, y = (np.vstack([item[index] for item in anchors]) for index in (0, 1))
            span = max(item[2] for item in anchors)
            if np.linalg.matrix_rank(x - x.mean(0), tol=span * 1e-7) < 2:
                continue
            before = rms(x - y)
            correction = fit(x, y)
            if rms(transform(correction, x) - y) < min(before * 0.05, span * 0.0001):
                fixes[arm][bone][frame] = Matrix([*correction, (0, 0, 0, 1)])
    return maximum, fixes


def correct_pose(scene, arm, fixes, frames):
    affected = set(fixes)
    for name in fixes:
        affected.update(child.name for child in arm.pose.bones[name].children)
    data = arm.animation_data
    if (
        not data
        or not data.action
        or not data.action_slot
        or len(data.action.layers) != 1
    ):
        return None
    original = data.action
    slot = data.action_slot
    values = defaultdict(list)
    previous = {}
    for frame in frames:
        scene.frame_set(frame)
        world = arm.matrix_world.copy()
        inverse = world.inverted_safe()
        pose = {name: bone.matrix.copy() for name, bone in arm.pose.bones.items()}
        for name, by_frame in fixes.items():
            if frame in by_frame:
                pose[name] = inverse @ by_frame[frame] @ world @ pose[name]
        for name in affected:
            bone = arm.pose.bones[name]
            parent = bone.parent
            kwargs = (
                {
                    "parent_matrix": pose[parent.name],
                    "parent_matrix_local": parent.bone.matrix_local,
                }
                if parent
                else {}
            )
            basis = bone.bone.convert_local_to_pose(
                pose[name], bone.bone.matrix_local, invert=True, **kwargs
            )
            position, rotation, scale = basis.decompose()
            mode = bone.rotation_mode
            if mode == "QUATERNION":
                field = "rotation_quaternion"
                if name in previous:
                    rotation.make_compatible(previous[name])
                previous[name] = rotation.copy()
                angles = rotation
            elif mode == "AXIS_ANGLE":
                axis, angle = rotation.to_axis_angle()
                field, angles = "rotation_axis_angle", [angle, *axis]
            else:
                angles = (
                    rotation.to_euler(mode, previous[name])
                    if name in previous
                    else rotation.to_euler(mode)
                )
                previous[name] = angles.copy()
                field = "rotation_euler"
            for prop, vector in [
                ("location", position),
                (field, angles),
                ("scale", scale),
            ]:
                for i, value in enumerate(vector):
                    values[bone.path_from_id(prop), i].append(value)
    action = original.copy()
    action.name = "MAX restored - " + arm.name
    new_slot = next(s for s in action.slots if s.identifier == slot.identifier)
    bag = action.layers[0].strips[0].channelbag(new_slot)
    for (path, axis), sequence in values.items():
        curve = bag.fcurves.find(path, index=axis) or bag.fcurves.new(path, index=axis)
        for i in range(len(curve.keyframe_points) - 1, -1, -1):
            key = curve.keyframe_points[i]
            if frames.start <= key.co.x < frames.stop:
                curve.keyframe_points.remove(key, fast=True)
        for frame, value in zip(frames, sequence):
            curve.keyframe_points.insert(
                frame, value, options={"FAST"}
            ).interpolation = "LINEAR"
        curve.update()
    data.action = action
    data.action_slot = new_slot
    original.use_fake_user = True
    arm["original_fbx_action"] = original.name
    return original, slot, action


def correct_surface(scene, obj, native, frames):
    """Bake residuals before skinning so edits to the armature still deform the corrected vertices."""
    if obj.data.shape_keys:
        return None
    arm = obj.find_armature()
    if any(
        m.type != "ARMATURE"
        or m.object != arm
        or m.use_deform_preserve_volume
        or m.vertex_group
        for m in obj.modifiers
    ):
        return None
    count = len(obj.data.vertices)
    base = np.empty(3 * count, dtype=np.float32)
    obj.data.vertices.foreach_get("co", base)
    base = base.reshape(-1, 3)
    weights = defaultdict(list)
    rest_inverse = {}
    if arm:
        names = {
            g.index: g.name
            for g in obj.vertex_groups
            if g.name in arm.data.bones and arm.data.bones[g.name].use_deform
        }
        for v in obj.data.vertices:
            groups = [
                (names[g.group], g.weight)
                for g in v.groups
                if g.group in names and g.weight > 0
            ]
            total = sum(w for _, w in groups)
            for name, value in groups:
                weights[name].append((v.index, value / total))
        weights = {
            n: (np.asarray([i for i, _ in rows]), np.asarray([w for _, w in rows]))
            for n, rows in weights.items()
        }
        rest_inverse = {
            n: np.linalg.inv(np.asarray(arm.data.bones[n].matrix_local))
            for n in weights
        }
    influenced = np.zeros(count, dtype=bool)
    for ids, _ in weights.values():
        influenced[ids] = True
    targets = {}
    graph = bpy.context.evaluated_depsgraph_get()
    for frame in frames:
        scene.frame_set(frame)
        current = world_vertices(obj, graph)
        expected = world_vertices(native, graph)
        delta = expected - current
        span = max(float(np.linalg.norm(np.ptp(expected, axis=0))), 1e-6)
        if np.max(np.linalg.norm(delta, axis=1)) < span * 0.000001:
            continue
        matrix = np.asarray(obj.matrix_world)
        evaluated = np.zeros((count, 3, 4))
        evaluated[~influenced] = matrix[:3]
        if weights:
            world = np.asarray(arm.matrix_world)
            local = np.linalg.inv(world) @ matrix
            for name, (ids, weight) in weights.items():
                bone = (
                    world
                    @ np.asarray(arm.pose.bones[name].matrix)
                    @ rest_inverse[name]
                    @ local
                )
                evaluated[ids] += weight[:, None, None] * bone[:3]
        predicted = (
            np.einsum("nij,nj->ni", evaluated[:, :, :3], base) + evaluated[:, :, 3]
        )
        if np.max(np.linalg.norm(predicted - current, axis=1)) > span * 0.00005:
            return None
        local_delta = np.einsum(
            "nij,nj->ni", np.linalg.pinv(evaluated[:, :, :3]), delta
        )
        if not np.all(np.isfinite(local_delta)):
            return None
        targets[frame] = np.asarray(base + local_delta, dtype=np.float32)
    if not targets:
        return None
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    obj.shape_key_add(name="Basis", from_mix=False)
    action = bpy.data.actions.new("MAX surface correction - " + obj.name)
    slot = action.slots.new("KEY", obj.name)
    bag = (
        action.layers.new("Native vertex residuals")
        .strips.new(type="KEYFRAME")
        .channelbag(slot, ensure=True)
    )
    for frame, rest in targets.items():
        key = obj.shape_key_add(name="MAX frame " + str(frame), from_mix=False)
        key.data.foreach_set("co", rest.ravel())
        curve = bag.fcurves.new(key.path_from_id("value"))
        points = curve.keyframe_points
        points.add(3)
        points.foreach_set("co", [frame - 1, 0, frame, 1, frame + 1, 0])
        for point in points:
            point.interpolation = "LINEAR"
        curve.update()
    data = obj.data.shape_keys.animation_data_create()
    data.action = action
    data.action_slot = slot
    corrected = measure(scene, [(obj, native)], frames, discover=False)[0][obj.name]
    if corrected[0] > 0.001:
        # Keep the imported editable rig intact if this modifier stack is non-linear.
        obj.shape_key_clear()
        bpy.data.actions.remove(action)
        return None
    return len(targets), corrected


def set_layers(scene, editable, original, pairs):
    scene.view_layers[0].name = "Editable rig"
    root = scene.collection
    work = bpy.data.collections.new("Editable rig")
    reference = bpy.data.collections.new("MAX evaluated")
    root.children.link(work)
    root.children.link(reference)
    for obj in editable:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        work.objects.link(obj)
    bodies = {native for _, native in pairs}
    helpers = bpy.data.collections.new("MAX rig display geometry")
    reference.children.link(helpers)
    for obj in original:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        # Max exports biped display shapes too. Keep them inspectable without covering the skin.
        is_helper = (
            obj not in bodies
            and obj.type == "MESH"
            and re.match(r"^bip\d+\b", obj.name, re.IGNORECASE)
        )
        (helpers if is_helper else reference).objects.link(obj)
    native = scene.view_layers.new("MAX evaluated")
    scene.view_layers[0].layer_collection.children[reference.name].exclude = True
    native.layer_collection.children[work.name].exclude = True
    has_surface = any(obj.type == "MESH" and len(obj.data.polygons) for obj in editable)
    native.layer_collection.children[reference.name].children[
        helpers.name
    ].exclude = has_surface


def port(row, base):
    path = ROOT / row["blend"]
    cache = base / "cache" / (row["sourceSha256"] + ".abc")
    bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    if scene.get("max_surface_cache"):
        from port_max_scenes import save_editable_scene

        bpy.ops.wm.open_mainfile(
            filepath=str(ROOT / row["groupLibrary"]), load_ui=False, use_scripts=False
        )
        source = next(
            s for s in bpy.data.scenes if s.get("source_max") == row["source"]
        )
        temporary = path.with_suffix(".source.blend")
        save_editable_scene(source, row, temporary)
        bpy.ops.wm.open_mainfile(
            filepath=str(temporary), load_ui=False, use_scripts=False
        )
        temporary.unlink()
        scene = bpy.context.scene
    editable = list(scene.objects)
    status = bpy.ops.wm.alembic_import(
        filepath=str(cache),
        always_add_cache_reader=True,
        set_frame_range=False,
        as_background_job=False,
    )
    if status != {"FINISHED"} or len(bpy.data.cache_files) != 1:
        raise ValueError("Expected one Blender-readable Alembic cache")
    graph = bpy.context.evaluated_depsgraph_get()
    graph.update()
    editable_set = set(editable)
    original = [obj for obj in scene.objects if obj not in editable_set]
    pairs, unmatched = pair_meshes(editable, original)
    faces = {
        obj.name: added
        for obj, native in pairs
        if (added := restore_faces(obj, native))
    }
    frames = range(row["start"], row["end"] + 1)
    before, fixes = measure(scene, pairs, frames, discover=True)
    restore = {}
    for arm, by_bone in fixes.items():
        action = correct_pose(scene, arm, by_bone, frames)
        if action:
            restore[arm] = action
    after = (
        measure(scene, pairs, frames, discover=False)[0] if restore else dict(before)
    )
    accepted = {}
    for arm, (old, old_slot, new) in restore.items():
        affected = [o.name for o, _ in pairs if o.find_armature() == arm]
        prev, post = [
            max(values[name][1] for name in affected) for values in [before, after]
        ]
        if post < prev * 0.99 and all(
            after[n][0] <= before[n][0] + 0.001 for n in affected
        ):
            accepted[arm.name] = sorted(fixes[arm])
        else:
            arm.animation_data.action = old
            arm.animation_data.action_slot = old_slot
            del arm["original_fbx_action"]
            bpy.data.actions.remove(new)
            for n in affected:
                after[n] = before[n]
    shapes = {}
    for obj, native in pairs:
        if after[obj.name][0] > 0.001:
            keys = correct_surface(scene, obj, native, frames)
            if keys:
                shapes[obj.name], after[obj.name] = keys

    scene.frame_set(row["start"])
    set_layers(scene, editable, original, pairs)
    separate_bone_geometry(scene, {native.name for _, native in pairs})
    relative = bpy.path.relpath(str(cache), start=str(path.parent))
    bpy.data.cache_files[0].filepath = relative
    scene["max_surface_cache"] = relative
    report = {
        "version": 2,
        "source": row["source"],
        "cache": cache.relative_to(base).as_posix(),
        "frames": len(frames),
        "topologyPairs": {obj.name: native.name for obj, native in pairs},
        "unmatched": unmatched,
        "restoredBones": accepted,
        "correctiveShapeKeys": shapes,
        "restoredFaces": faces,
        "packedReferenceImages": pack_referenced_images(row),
        "referenceDisplay": True,
        "before": before,
        "after": after,
    }
    scene["max_surface_audit"] = json.dumps(report, ensure_ascii=False)
    # Save a complete startup UI as well as the scene datablocks. Keep filenames portable.
    bpy.context.preferences.filepaths.save_version = 0
    window = bpy.context.window
    window.scene = scene
    window.view_layer = scene.view_layers[0]
    meshes = [obj for obj in editable if obj.type == "MESH" and len(obj.data.polygons)]
    # Rig-only files open with overlays and a view of their actual bone extents.
    points = [
        obj.matrix_world @ Vector(v)
        for obj in (meshes or editable)
        for v in obj.bound_box
        if obj.type in {"MESH", "ARMATURE"}
    ]
    if points:
        low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
        high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
        for area in bpy.context.screen.areas:
            if area.type == "VIEW_3D":
                view = area.spaces.active
                view.region_3d.view_location = (low + high) / 2
                view.region_3d.view_distance = max((high - low).length, 0.1) * 1.4
                view.shading.color_type = "TEXTURE"
                view.overlay.show_overlays = not meshes
    temporary = path.with_suffix(".partial.blend")
    bpy.ops.wm.save_as_mainfile(filepath=str(temporary), compress=True)
    bpy.ops.wm.open_mainfile(filepath=str(temporary), load_ui=False, use_scripts=False)
    saved = bpy.context.scene
    if saved.get("source_max") != row["source"] or not any(
        layer.name == "MAX evaluated" for layer in saved.view_layers
    ):
        raise ValueError("Saved native/reference layers failed to reopen")
    if (
        Path(bpy.path.abspath(bpy.data.cache_files[0].filepath)).resolve()
        != cache.resolve()
    ):
        raise ValueError("Saved cache reference no longer reaches the native asset")
    temporary.replace(path)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=WORK / "max-preservation")
    parser.add_argument("--sources", nargs="+")
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--shards", type=int, default=1)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Rebuild selected generated files from the original editable library",
    )
    args = parser.parse_args()
    base = args.base.resolve()
    requested = {p.casefold() for p in args.sources or []}
    rows = read_json(base / "blend/index.json")["scenes"]
    if not 0 <= args.shard < args.shards:
        parser.error("Shard must be in the range [0, shards)")
    if requested - {r["source"].casefold() for r in rows}:
        parser.error("Unknown MAX path in --sources")
    failures = 0
    for i, row in enumerate(rows):
        if (
            i % args.shards != args.shard
            or requested
            and row["source"].casefold() not in requested
        ):
            continue
        key = hashlib.sha256(row["source"].encode()).hexdigest()[:24]
        record = base / "port-records" / (key + ".json")
        if record.is_file() and not args.force:
            continue
        try:
            result = port(row, base)
            save_json(record, result)
            record.with_suffix(".error.json").unlink(missing_ok=True)
            print(
                "OK",
                row["source"],
                "frames",
                result["frames"],
                "restored",
                result["restoredBones"],
                flush=True,
            )
        except Exception as error:  # noqa: BLE001 -- Preserve independent files and report each failed scene.
            import traceback

            failures += 1
            traceback.print_exc()
            save_json(
                record.with_suffix(".error.json"),
                {"source": row["source"], "error": str(error)},
            )
    if failures:
        raise SystemExit(
            f"{failures} Blender scene(s) failed; see port-records/*.error.json"
        )


if __name__ == "__main__":
    main()
