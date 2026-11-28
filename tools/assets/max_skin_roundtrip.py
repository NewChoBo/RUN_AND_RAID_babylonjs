"""Reopen sample original scenes and restore deliberately perturbed, in-memory Skin data."""

import gzip
import json
import os
from pathlib import Path

from max_skin_authoring import matrix_values
from pymxs import runtime as rt


def matrix(values):
    return rt.matrix3(*(rt.point3(*values[i : i + 3]) for i in range(0, 12, 3)))


def difference(expected, actual):
    return max(abs(a - b) for a, b in zip(expected, actual, strict=True))


def test_skin(out, node, skin, original):
    b = original["bones"][0]
    bone = rt.maxOps.getNodeByHandle(b["node"])
    entries = [
        (
            rt.skinUtils.getMeshBindTM,
            rt.skinUtils.setMeshBindTM,
            [node],
            original["meshBind"],
        ),
        (
            rt.skinUtils.getBoneBindTM,
            rt.skinUtils.setBoneBindTM,
            [node, bone],
            b["bind"],
        ),
        (
            rt.skinUtils.getBoneStretchTM,
            rt.skinUtils.setBoneStretchTM,
            [node, bone],
            b["stretch"],
        ),
    ]
    transforms = []
    for getter, setter, owners, values in entries:
        live = matrix_values(getter(*owners))
        altered = values.copy()
        altered[-1] += 1.25
        setter(*owners, matrix(altered))
        perturbed = difference(values, matrix_values(getter(*owners)))
        setter(*owners, matrix(values))
        restored = difference(values, matrix_values(getter(*owners)))
        transforms.append(
            {
                "reopenedDiff": difference(values, live),
                "perturbed": perturbed,
                "restoredDiff": restored,
            }
        )
    id_ = b["boneID"]
    inner = b["sections"][0][1]
    rt.skinOps.setInnerRadius(skin, id_, 1, inner * 0.5)
    edited = float(rt.skinOps.getInnerRadius(skin, id_, 1))
    rt.execute("""(
        fn raidSkinLoadConfirm = (
            local h=DialogMonitorOPS.GetWindowHandle()
            local title=UIAccessor.GetWindowText h
            if title!=undefined and matchPattern title pattern:"*load envelopes*" ignoreCase:true do (
                UIAccessor.PressButtonByName h "Match By Name"
                UIAccessor.SendMessageID h #IDOK
            )
            true
        )
        DialogMonitorOPS.RegisterNotification raidSkinLoadConfirm id:#RaidSkinRoundTrip
        DialogMonitorOPS.Enabled=true
    )""")
    try:
        rt.skinOps.loadEnvelope(skin, str(out / original["file"]))
    finally:
        rt.execute("DialogMonitorOPS.UnRegisterNotification id:#RaidSkinRoundTrip")
    env_reloaded = float(rt.skinOps.getInnerRadius(skin, id_, 1))
    # Some batch hosts suppress the envelope window. The portable data can also be
    # applied through SkinOps directly, so report both results independently.
    rt.skinOps.setInnerRadius(skin, id_, 1, inner)
    restored = float(rt.skinOps.getInnerRadius(skin, id_, 1))
    dq = original["dq"][0]
    rt.skinOps.setVertexDQWeight(skin, 1, 1.0 if dq == 0.0 else 0.0)
    changed = float(rt.skinOps.getVertexDQWeight(skin, 1))
    rt.skinOps.setVertexDQWeight(skin, 1, dq)
    return {
        "node": original["name"],
        "bindTransforms": transforms,
        "radius": {
            "original": inner,
            "perturbed": edited,
            "afterNativeEnvelopeLoad": env_reloaded,
            "afterSkinOps": restored,
        },
        "dq": {
            "original": dq,
            "perturbed": changed,
            "restored": float(rt.skinOps.getVertexDQWeight(skin, 1)),
        },
    }


def run():
    root = Path(os.environ["RUN_RAID_PROJECT"])
    out = root / ".asset-work/max-preservation/native/envelopes"
    plan = json.loads((out.parent / "plan.json").read_text("utf8"))
    samples = {
        "hammer/animation/hammer#default#attack1.max",
        "alice/animation/alice#default#attack1.max",
        "kaiken/kaiken#default.max",
    }
    results = []
    for row in plan:
        if row["source"].casefold() not in samples:
            continue
        with gzip.open(
            out / (row["sha256"] + ".json.gz"), "rt", encoding="utf8"
        ) as stream:
            original = json.load(stream)
        rt.resetMaxFile(rt.name("noPrompt"))
        if not rt.loadMaxFile(
            str(root / "asset-sources/player" / row["source"]),
            quiet=True,
            useFileUnits=True,
        ):
            raise ValueError("Unable to reopen " + row["source"])
        for s in original["skins"]:
            node = rt.maxOps.getNodeByHandle(s["node"])
            skin = node.modifiers[s["stackIndex"]]
            metrics = test_skin(out, node, skin, s)
            metrics["source"] = row["source"]
            results.append(metrics)
            (out / "roundtrip.json").write_text(
                json.dumps(results, ensure_ascii=False, indent=2), "utf8"
            )


if __name__ == "__main__":
    run()
