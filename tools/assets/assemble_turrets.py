"""Port the common Hof turret deployment, firing and travel takes onto the nine original weapon/skin rigs.

Run with the Blender Python environment used for assemble_player.py. glTF inverse binds
allow the same mesh-space deformation on rigs exported with different armature axes.
"""

import bisect
import json
import struct

import bpy  # Registers mathutils in the standalone bpy environment.
from mathutils import Matrix, Quaternion, Vector

from activate import fighter_materials
from library import PUBLIC, ROOT, write_changed

FOLDER = PUBLIC / "models/hof"
OUTPUT = ROOT / "public/assets/raid/turrets"
WIDTH = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class TurretScene:
    def __init__(self, path, take=0):
        data = path.read_bytes()
        size = struct.unpack_from("<I", data, 12)[0]
        self.doc = json.loads(data[20 : 20 + size])
        self.binary = bytearray(data[28 + size :])
        self.nodes = self.doc["nodes"]
        self.parent = {
            child: i
            for i, node in enumerate(self.nodes)
            for child in node.get("children", [])
        }
        skin = self.doc["skins"][0]
        self.joints = {
            self.nodes[index]["name"]: (
                index,
                Matrix([row[i : i + 4] for i in range(0, 16, 4)]).transposed(),
            )
            for index, row in zip(
                skin["joints"], self.values(skin["inverseBindMatrices"]), strict=True
            )
        }
        clip = self.doc["animations"][take]
        self.channels = {}
        for channel in clip["channels"]:
            target = channel["target"]
            sampler = clip["samplers"][channel["sampler"]]
            self.channels[target["node"], target["path"]] = (
                [v[0] for v in self.values(sampler["input"])],
                self.values(sampler["output"]),
            )
        self.frames = round(30 * max(times[-1] for times, _ in self.channels.values()))

    def values(self, index):
        a = self.doc["accessors"][index]
        view = self.doc["bufferViews"][a["bufferView"]]
        count = WIDTH[a["type"]]
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        assert a["componentType"] == 5126 and not view.get("byteStride")
        return list(
            struct.iter_unpack(
                "<" + "f" * count, self.binary[start : start + 4 * count * a["count"]]
            )
        )

    def world(self, frame):
        result = {}

        def sample(i, prop, default):
            key = i, prop
            if key not in self.channels:
                return self.nodes[i].get(prop, default)
            times, values = self.channels[key]
            t = frame / 30
            right = bisect.bisect_right(times, t)
            if right == 0 or right == len(times):
                return values[0] if right == 0 else values[-1]
            frac = (t - times[right - 1]) / (times[right] - times[right - 1])
            a, b = values[right - 1 : right + 1]
            if prop == "rotation":
                qa, qb = (Quaternion((r[3], *r[:3])) for r in (a, b))
                q = qa.slerp(qb, frac)
                return q.x, q.y, q.z, q.w
            return Vector(a).lerp(Vector(b), frac)

        def visit(i):
            if i not in result:
                x, y, z, w = sample(i, "rotation", (0, 0, 0, 1))
                local = Matrix.LocRotScale(
                    Vector(sample(i, "translation", (0, 0, 0))),
                    Quaternion((w, x, y, z)),
                    Vector(sample(i, "scale", (1, 1, 1))),
                )
                result[i] = visit(self.parent[i]) @ local if i in self.parent else local
            return result[i]

        for i in range(len(self.nodes)):
            visit(i)
        return result

    def add_buffer(self, kind, values):
        data = b"".join(struct.pack("<" + "f" * len(row), *row) for row in values)
        views = self.doc["bufferViews"]
        views.append(
            {"buffer": 0, "byteOffset": len(self.binary), "byteLength": len(data)}
        )
        self.binary.extend(data)
        a = {
            "componentType": 5126,
            "type": kind,
            "count": len(values),
            "bufferView": len(views) - 1,
        }
        if kind == "SCALAR":
            a.update(min=[values[0][0]], max=[values[-1][0]])
        self.doc["accessors"].append(a)
        return len(self.doc["accessors"]) - 1

    def transfer(self, name, source, poses):
        assert set(self.joints) == set(source.joints)
        rest = self.world(0)
        samples = {index: [[], [], []] for index, _ in self.joints.values()}
        for pose in poses:
            world = rest.copy()
            for bone, (index, bind) in self.joints.items():
                origin, src_bind = source.joints[bone]
                world[index] = pose[origin] @ src_bind @ bind.inverted()
            for i, (positions, rotations, scales) in samples.items():
                local = world[self.parent[i]].inverted() @ world[i]
                p, q, s = local.decompose()
                if rotations:
                    x, y, z, w = rotations[-1]
                    q.make_compatible(Quaternion((w, x, y, z)))
                positions.append(tuple(p))
                rotations.append((q.x, q.y, q.z, q.w))
                scales.append(tuple(s))
        time = self.add_buffer("SCALAR", [(f / 30,) for f in range(len(poses))])
        clip = {"name": name, "samplers": [], "channels": []}
        for i, channels in samples.items():
            for path, kind, values in zip(
                ("translation", "rotation", "scale"), ("VEC3", "VEC4", "VEC3"), channels
            ):
                out = self.add_buffer(kind, values)
                clip["channels"].append(
                    {
                        "sampler": len(clip["samplers"]),
                        "target": {"node": i, "path": path},
                    }
                )
                clip["samplers"].append(
                    {"input": time, "output": out, "interpolation": "LINEAR"}
                )
        return clip

    def pack(self):
        self.doc["buffers"][0]["byteLength"] = len(self.binary)
        doc = json.dumps(self.doc, ensure_ascii=False, separators=(",", ":")).encode()
        doc += b" " * (-len(doc) % 4)
        return fighter_materials(
            struct.pack(
                "<4sIII4s",
                b"glTF",
                2,
                28 + len(doc) + len(self.binary),
                len(doc),
                b"JSON",
            )
            + doc
            + struct.pack("<I4s", len(self.binary), b"BIN\0")
            + self.binary
        )


def main():
    takes = {}
    for name in ["spawn", "attack", "run"]:
        source = TurretScene(FOLDER / f"hof-default-turret-{name}.glb")
        takes[name] = source, [source.world(f) for f in range(source.frames + 1)]
    for skin in ["default", "astronaut", "western"]:
        for kind in ["gun", "ice", "thunder"]:
            target = TurretScene(FOLDER / f"hof-{skin}-turret-{kind}-scene.glb")
            target.doc["animations"] = [
                target.transfer(name, source, poses)
                for name, (source, poses) in takes.items()
            ]
            write_changed(OUTPUT / f"hof-{skin}-{kind}.glb", target.pack())


if __name__ == "__main__":
    main()
