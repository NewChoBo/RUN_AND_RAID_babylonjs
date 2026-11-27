"""Bake source skin deformation onto the default playable body using its own bind pose."""

import argparse
import gzip
import json
import math
import re
import struct
from functools import lru_cache
from pathlib import Path

import bpy
from activate import activate, fighter_materials, write_glb_json
from asset_names import outfit_name
from library import PUBLIC, ROOT, WORK, read_json, save_json
from mathutils import Matrix

STANDARD = {
    "run": "run",
    "walk": "walk",
    "jump": "jump_loop",
    "fall": "die",
    "basic": "attack1",
    "pulse": "skill1start",
    "bolt": "skill2start",
    "field": "skill3start",
    "fury": "skill4start",
}
OVERRIDES = {
    "alice": {"orbLoop": "skill4loop"},
    "kaiken": {"fullMoonEnd": "skill3end"},
    "elfprince": {"bolt": "skill2start1"},
    "vallet": {"fury": "skill4"},
    "hof": {"jump": ("jump_loopup", "jump_loopdown"), "bolt": "humanmissle",
            "field": "megabomb", "fury": "rapidrockets"},
    "magnus": {"pulse": "shockwave", "bolt": "shield_attack2", "field": "battleshout",
               "fury": "switchmode", "shieldCharge": "rollingattack", "shieldRun": "shield_run",
               "shieldBasic": "shield_attack1", "shieldJump": "shield_jump_loop"},
    "rildin": {"pulse": "skill1start1", "slash2": "skill1start2", "slash3": "skill1start3",
               "slash4": "skill1start4", "fury": "unleashedsword"},
    "kali": {
        "bolt": "attack1"
    },  # Poison arms the next basic attack; no skill2 take in the archive.
}


def rig_and_body(scene):
    meshes = [ob for ob in scene.objects if ob.type == "MESH" and ob.find_armature()]
    body = max(meshes, key=lambda ob: len(ob.data.vertices))
    return body.find_armature(), body


@lru_cache(maxsize=1)
def native_group(group):
    path = WORK / "player-release/Reference" / (group + ".json.gz")
    with gzip.open(path, "rt", encoding="utf8") as f:
        return json.load(f)


def source_record(scene):
    key = scene["source_max"].lower()
    return native_group(key.split("/")[0])[key]


def sample_motion(target, mesh, scene, body):
    bpy.context.window.scene = scene
    first, last = scene.frame_start, scene.frame_end
    if first >= last:
        raise ValueError(f"Empty take: {scene.name}")
    scene.frame_set(first)
    source = body.find_armature()
    native = source_record(scene)["meshes"][body.name]
    fixes = native["corrections"]
    # Evaluate skinning in the source mesh's coordinates. A Max file may store a different
    # animated armature object transform and bind pose for each take of the same character.
    target_world = target.matrix_world.copy()
    target_inv = target_world.inverted()
    src_mesh_bind_inv = body.matrix_world.inverted()
    bones = {b.name: b for b in target.data.bones}
    source_rest_inv = {
        b.name: b.matrix_local.inverted() for b in source.data.bones if b.name in bones
    }
    required = {g.name for g in mesh.vertex_groups if g.name in bones}
    if not source_rest_inv.keys() & required:
        raise ValueError(f"No corresponding weighted bones for {scene.name}")
    local_inv = {
        n: b.matrix_local.inverted() @ (b.parent.matrix_local if b.parent else Matrix.Identity(4))
        for n, b in bones.items()
    }
    root_to_bind = {n: target_world @ b.matrix_local for n, b in bones.items()}
    samples = {n: [] for n in bones}
    previous = {}
    for frame in range(first, last + 1):
        scene.frame_set(frame)
        source_world = source.matrix_world
        left = target_inv @ source_world
        corrected = {}
        for name, frames in fixes.items():
            rows = frames.get(str(frame))
            if rows:
                fix = Matrix([*rows, (0, 0, 0, 1)])
                corrected[name] = target_inv @ fix @ source_world
        right = source_world.inverted() @ body.matrix_world @ src_mesh_bind_inv
        pose = {}
        for n, bone in bones.items():
            parent = bone.parent
            parent_matrix = pose[parent.name] if parent else Matrix.Identity(4)
            if n in source_rest_inv:
                pose[n] = (
                    corrected.get(n, left)
                    @ source.pose.bones[n].matrix
                    @ source_rest_inv[n]
                    @ right
                    @ root_to_bind[n]
                )
                basis = local_inv[n] @ parent_matrix.inverted_safe() @ pose[n]
            else:
                basis = Matrix.Identity(4)
                pose[n] = parent_matrix @ local_inv[n].inverted_safe()
            loc, rot, scale = basis.decompose()
            if n in previous:
                rot.make_compatible(previous[n])
            previous[n] = rot
            samples[n].append((*loc, *rot, *scale))
    return samples


def motion_action(name, target, mesh, takes, output_fps):
    samples = {b.name: [] for b in target.data.bones}
    times = []
    for scene, body in takes:
        segment = sample_motion(target, mesh, scene, body)
        clock = source_record(scene)["timing"]
        ticks = clock["ticksPerFrame"]
        if (scene.frame_start * ticks, scene.frame_end * ticks) != (clock["startTick"], clock["endTick"]):
            raise ValueError("Blender and Max frame ranges differ: " + scene["source_max"])
        step = output_fps // clock["fps"]
        # A shared boundary has one key. The following take owns its first pose.
        start = times.pop() if times else 0
        times.extend(start + i * step for i in range(scene.frame_end - scene.frame_start + 1))
        for n, values in segment.items():
            if samples[n]:
                samples[n].pop()
                # Preserve quaternion continuity where two original takes meet.
                if sum(a * b for a, b in zip(samples[n][-1][3:7], values[0][3:7])) < 0:
                    values = [(*v[:3], *(-q for q in v[3:7]), *v[7:]) for v in values]
            samples[n].extend(values)
    action = bpy.data.actions.new(name)
    slot = action.slots.new("OBJECT", target.name)
    strip = action.layers.new(name).strips.new(type="KEYFRAME")
    bag = strip.channelbag(slot, ensure=True)
    for n, values in samples.items():
        bone = target.pose.bones[n]
        column = 0
        for key, count in [("location", 3), ("rotation_quaternion", 4), ("scale", 3)]:
            for i in range(count):
                fcurve = bag.fcurves.new(bone.path_from_id(key), index=i)
                points = fcurve.keyframe_points
                points.add(len(values))
                points.foreach_set(
                    "co", [v for time, row in zip(times, values) for v in (time, row[column + i])]
                )
                for point in points:
                    point.interpolation = "LINEAR"
                fcurve.update()
            column += count
    return action


def find_take(scenes, prefixes, tokens, weights):
    minimum = 0.90 * sum(weights.values())
    if not minimum:
        return None
    for prefix in prefixes:
        for token in tokens:
            suffixes = (f"/{prefix}#{token}.max", f"/{prefix}_{token}.max")
            for key in sorted((k for k in scenes if k.endswith(suffixes)), key=lambda k: (k.count("/"), k)):
                scene = scenes[key]
                if scene.frame_end <= scene.frame_start:
                    continue
                bodies = [o for o in scene.objects if o.type == "MESH" and o.find_armature()]
                def match(body):
                    bones = body.find_armature().data.bones
                    return sum(w for n, w in weights.items() if n in bones), len(body.data.vertices)
                if bodies:
                    body = max(bodies, key=match)
                    if match(body)[0] >= minimum:
                        return scene, body
    return None


def assemble(blend, outfit=None, item=None, plan=None):
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    hero = blend.stem.lower()
    scenes = {s["source_max"].lower(): s for s in bpy.data.scenes}
    base = scenes[item["path"].lower() if item else f"{hero}/{hero}#default.max"]
    skin = outfit["skin"] if outfit else "default"
    if plan is not None:
        plan["bodies"].add(base["source_max"].lower())
    output = WORK / "player-release" / "Fighters" / hero / outfit_name(hero, skin)
    output.parent.mkdir(parents=True, exist_ok=True)

    def keep_source():
        import shutil

        shutil.copyfile(PUBLIC / item["model"], output)
        save_json(output.with_suffix(".json"), {"source": item["path"], "clips": item["clips"]})

    if item and not any(ob.type == "MESH" and ob.find_armature() for ob in base.objects):
        if plan is None:
            keep_source()
        return
    bpy.context.window.scene = base
    base.frame_set(base.frame_start)
    target, mesh = rig_and_body(base)
    world = {o: o.matrix_world.copy() for o in base.objects if o.type in {"MESH", "ARMATURE"}}
    for o in base.objects:
        o.animation_data_clear()
    target.parent = None
    target.matrix_world = world[target]
    for ob, mat in world.items():
        if ob.type == "MESH":
            ob.matrix_world = mat
    for bone in target.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.matrix_basis = Matrix.Identity(4)
    data = target.animation_data_create()
    paths = {}
    motion_nodes = set()
    if plan is None:
        # Every source frame boundary must land on the integer bake grid, including mixed FPS.
        base.render.fps = math.lcm(*(v["timing"]["fps"] for v in native_group(hero).values()))
    prefix = Path(base["source_max"]).stem.lower()
    prefixes = [prefix]
    if "#" in prefix and hero != "base":
        prefixes.append(prefix.rsplit("#", 1)[0] + "#default")
    weights = {}
    for vertex in mesh.data.vertices:
        for g in vertex.groups:
            n = mesh.vertex_groups[g.group].name
            weights[n] = weights.get(n, 0.0) + g.weight
    mapping = STANDARD | OVERRIDES.get(hero, {})
    if hero == "ella" and skin == "bigbird#default":
        mapping["field"] = "skill3hit_a"
    for clip, take in mapping.items():
        stages = take if isinstance(take, tuple) else (take,)
        takes = []
        for stage in stages:
            tokens = [stage, "run", "fly", "idle"] if clip in {"run", "walk"} else [stage]
            found = find_take(scenes, dict.fromkeys(prefixes), tokens, weights)
            if found:
                takes.append(found)
        if len(takes) != len(stages):
            continue
        if plan is not None:
            plan["motion"].update(s["source_max"].lower() for s, _ in takes)
            continue
        action = motion_action(clip, target, mesh, takes, base.render.fps)
        for scene, _ in takes:
            motion_nodes.update(n.casefold() for n in source_record(scene)["geometry"])
        track = data.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, 0, action)
        parts = [{"source": s["source_max"], "frames": [s.frame_start, s.frame_end], "mesh": ob.name,
                  "timing": source_record(s)["timing"]} for s, ob in takes]
        paths[clip] = parts[0] if len(parts) == 1 else {"stages": parts}
    if plan is not None:
        return
    if not paths and item:
        keep_source()
        return
    bpy.context.window.scene = base
    base.render.fps_base = 1
    bpy.ops.object.select_all(action="DESELECT")
    for ob in world:
        # Loose workshop objects next to the outfit have no counterpart in its takes.
        # Keep bone-parented accessories and the original archive scenes intact.
        if (ob.type == "MESH" and not ob.find_armature() and ob.parent is None
                and re.sub(r"\.\d{3}$", "", ob.name).casefold() not in motion_nodes):
            continue
        ob.select_set(True)
    bpy.context.view_layer.objects.active = target
    folder = WORK / "player-release" / "Playable"
    folder.mkdir(parents=True, exist_ok=True)
    out = output if outfit else folder / (hero + ".glb")
    tmp = out.with_suffix(".partial.glb")
    bpy.ops.export_scene.gltf(
        filepath=str(tmp),
        export_format="GLB",
        use_active_scene=True,
        use_selection=True,
        export_animation_mode="NLA_TRACKS",
        export_anim_single_armature=False,
        export_influence_nb=8,
        export_cameras=False,
        export_lights=False,
    )
    data = tmp.read_bytes()
    size = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20+size])
    for anim in gltf["animations"]:
        entry = paths[anim["name"]]
        takes = entry.get("stages", [entry])
        times = [take["timing"] for take in takes]
        seconds = sum((t["endTick"]-t["startTick"])/(t["fps"]*t["ticksPerFrame"]) for t in times)
        accessors = [gltf["accessors"][s["input"]] for s in anim["samplers"]]
        actual = max(a["max"][0] for a in accessors) - min(a["min"][0] for a in accessors)
        if abs(actual-seconds) > 0.0001:
            raise ValueError(f"{hero}/{skin}/{anim['name']}: exported {actual}s, expected {seconds}s")
        anim.setdefault("extras", {})["sourceTiming"] = {"seconds":seconds, "takes":times}
    tmp.write_bytes(write_glb_json(data,gltf))
    if not outfit:
        tmp.write_bytes(fighter_materials(tmp.read_bytes()))
        activate(hero, tmp)
    tmp.replace(out)
    save_json(out.with_suffix(".json"), {"source": base["source_max"], "clips": paths})
    print("Assembled", hero, skin, list(paths), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("groups", nargs="*")
    parser.add_argument("--outfits", action="store_true")
    parser.add_argument("--plan", action="store_true", help="Resolve Max sources for every published outfit")
    args = parser.parse_args()
    if args.plan and args.groups:
        parser.error("--plan resolves the complete outfit catalog")
    if args.outfits or args.plan:
        plan = {"motion": set(), "bodies": set()} if args.plan else None
        approved = {
            (o["group"], o["skin"])
            for o in read_json(ROOT / "src/content/raid/published-outfits.json")
        }
        bodies = {
            r["model"]: r for r in read_json(PUBLIC / "catalog.json")["files"] if r.get("model")
        }
        for outfit in read_json(ROOT / "src/content/raid/local-outfits.json"):
            group, skin = outfit["group"], outfit["skin"]
            if (group, skin) in approved and (not args.groups or group in args.groups):
                item = bodies[outfit["model"]]
                assemble(WORK / "player-release/Blender" / (item["group"] + ".blend"), outfit, item, plan)
        if plan is not None:
            save_json(WORK / "max-motion-plan.json", {k: sorted(v) for k,v in plan.items()})
    else:
        for group in args.groups:
            assemble(WORK / "player-release" / "Blender" / (group + ".blend"))
