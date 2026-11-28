"""Preserve native animation keys and Character Studio motion from an open Max scene."""

import gzip
import hashlib
import json
from pathlib import Path

from pymxs import runtime as rt


def encoded(value):
    if value is None or isinstance(value, (bool, float, int, str)):
        return value
    kind = str(rt.classOf(value)).lower()
    if kind == "time":
        return round(value.frame * rt.ticksPerFrame)
    if kind in {"point2", "point3", "point4", "quat", "color", "acolor"}:
        components = "rgba" if "color" in kind else "xyzw"
        return [float(getattr(value, c)) for c in components if hasattr(value, c)]
    # AngleAxis and plug-in-specific values retain their native class and printed representation.
    return str(value)


_VALUE_FIELDS = ["value", "selected"]
_TCB = ["tension", "continuity", "bias", "easeTo", "easeFrom"]
_BEZIER = [
    "inTangent",
    "outTangent",
    "inTangentType",
    "outTangentType",
    "inTangentLength",
    "outTangentLength",
    "freeHandle",
    "x_locked",
    "y_locked",
    "z_locked",
    "constantVelocity",
]
_BIPED = [
    "type",
    "ikBlend",
    "ikSpace",
    "ikJoinedPivot",
    "ikAnkleTension",
    "ikNumPivots",
    "ikPivots",
    "ikPivotIndex",
    "ikEnable",
    "ikObject",
    "ikSelectedPivot",
    "ballisticTension",
    "dynamicsBlend",
    "dynamicsType",
]
_FIELD_SETS = {}
_SLOT_CONTROLLERS = rt.execute("""(fn raidAuthoringTrackSlots owner = (
    local result = #(), pending = #(#(owner, "", 0))
    while pending.count > 0 do (
        local item = pending[pending.count]
        deleteItem pending pending.count
        local slots = item[1], prefix = item[2], depth = item[3]
        for i=1 to slots.numSubs do (
            local s = getSubAnim slots i
            local label = prefix + "/" + ((getSubAnimName slots i) as string)
            local ctrl = try(s.controller)catch(undefined)
            if ctrl != undefined then append result #(label, ctrl)
            else if depth < 2 do (
                local block = try(s.value)catch(undefined)
                if block != undefined and matchPattern ((classOf block) as string) pattern:"*paramblock*" do
                    append pending #(block, label, depth+1)
            )
        )
    )
    result
))""")


def read_track(controller, class_name, count):
    biped = "bip" in class_name or "vertical_horizontal_turn" in class_name
    methods = [rt.biped.getKey, rt.getKey] if biped else [rt.getKey, rt.biped.getKey]
    method = None
    for candidate in methods:
        try:
            first = candidate(controller, 1)
            if first is not None and first.time is not None:
                method = candidate
                break
        except (RuntimeError, AttributeError, TypeError):
            continue
    if method is None:
        return {"unreadableKeys": count}
    # BipedKey families expose different IK properties. Probe once per controller
    # and key family instead of raising unsupported-property errors on every limb.
    family = (
        class_name,
        str(rt.classOf(first)),
        str(getattr(first, "type", "")) if biped else "",
    )
    fields = _FIELD_SETS.get(family)
    if fields is None:
        fields = []
        for name in _VALUE_FIELDS + _TCB + _BEZIER + _BIPED:
            try:
                getattr(first, name)
                fields.append(name)
            except (RuntimeError, AttributeError, TypeError):
                continue
        _FIELD_SETS[family] = fields
    samples = []
    for i in range(1, count + 1):
        key = first if i == 1 else method(controller, i)
        values = [round(key.time.frame * rt.ticksPerFrame)]
        for field in fields:
            try:
                values.append(encoded(getattr(key, field)))
            except (RuntimeError, AttributeError, TypeError):
                values.append(None)
        samples.append(values)
    return {"fields": ["tick", *fields], "keys": samples}


def save_tracks(path, source_name, objects):
    """Call last, after all other observations. The source scene is never saved."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    result = {
        "version": 2,
        "source": source_name,
        "tracks": {},
        "roots": {},
        "bipeds": [],
        "warnings": [],
    }
    tracks = result["tracks"]
    prior_bips = {}
    if path.is_file():
        with gzip.open(path, "rt", encoding="utf8") as stream:
            previous = json.load(stream)
        if previous.get("source") == source_name:
            prior_bips = {b["file"]: b for b in previous["bipeds"]}

    def visit(ctrl):
        handle = str(int(rt.getHandleByAnim(ctrl)))
        if handle in tracks:
            return handle
        klass = str(rt.classOf(ctrl))
        track = {"class": klass}
        tracks[handle] = track
        try:
            count = int(rt.numKeys(ctrl))
            if count > 0:
                track.update(read_track(ctrl, klass.lower(), count))
        except (RuntimeError, AttributeError, TypeError) as error:
            track["keyAccessError"] = str(error)
        children = []
        for i in range(1, int(ctrl.numSubs) + 1):
            sub = rt.getSubAnim(ctrl, i)
            child = getattr(sub, "controller", None)
            if child is not None:
                children.append([str(rt.getSubAnimName(ctrl, i)), visit(child)])
        if children:
            track["children"] = children
        return handle

    for obj in objects:
        try:
            ctrl = obj.controller
            if ctrl is None:
                continue
            handle = str(int(obj.handle))
            result["roots"][handle] = {"name": str(obj.name), "track": visit(ctrl)}
            if str(rt.classOf(ctrl)).lower() == "vertical_horizontal_turn":
                target = path.with_name(path.name.split(".")[0] + "-" + handle + ".bip")
                prior = prior_bips.get(target.name)
                checksum = (
                    hashlib.sha256(target.read_bytes()).hexdigest()
                    if target.is_file() and target.stat().st_size
                    else None
                )
                if (
                    not checksum
                    or not prior
                    or prior.get("sha256", checksum) != checksum
                ):
                    temporary = target.with_suffix(".partial.bip")
                    rt.biped.saveBipFile(
                        ctrl, str(temporary), rt.name("saveSubAnimControllers")
                    )
                    if not temporary.is_file() or not temporary.stat().st_size:
                        raise ValueError("Empty Character Studio motion")
                    checksum = hashlib.sha256(temporary.read_bytes()).hexdigest()
                    temporary.replace(target)
                result["bipeds"].append(
                    {"node": handle, "file": target.name, "sha256": checksum}
                )
        except (RuntimeError, AttributeError, TypeError, ValueError) as error:
            result["warnings"].append({"node": str(obj.name), "reason": str(error)})
    slots = {}
    owners = []
    for obj in objects:
        try:
            visibility = rt.getPropertyController(obj, rt.name("visibility"))
            if visibility is not None:
                slots["node/" + str(obj.handle) + "/visibility"] = visit(visibility)
            owners.extend(
                (f"{obj.handle}/modifier/{i}", m) for i, m in enumerate(obj.modifiers)
            )
            owners.append((f"{obj.handle}/base", obj.baseObject))
        except (AttributeError, TypeError, RuntimeError) as error:
            result["warnings"].append({"node": str(obj.name), "reason": str(error)})
    owners.extend(("material/" + str(m.name), m) for m in rt.sceneMaterials)
    for label, owner in owners:
        try:
            if owner is not None:
                for key, controller in _SLOT_CONTROLLERS(owner):
                    slots[label + str(key)] = visit(controller)
        except (AttributeError, TypeError, RuntimeError) as error:
            result["warnings"].append({"node": label, "reason": str(error)})
    result["parameterTracks"] = slots
    temp = path.with_name(path.name + ".partial")
    with gzip.open(temp, "wt", encoding="utf8", compresslevel=2) as stream:
        json.dump(result, stream, ensure_ascii=False, separators=(",", ":"))
    temp.replace(path)
