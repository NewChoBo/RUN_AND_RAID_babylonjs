"""Render the remake's mono PCM one-shots. Uses only the Python standard library."""

import array
import math
from pathlib import Path
import random
import sys
import wave

DEST = Path(__file__).resolve().parents[2] / "public/assets/audio"
RATE = 22050
# Duration, start/end pitch, tonal partials, noise level, noise smoothing, decay.
PATCHES = {
    "hammer": (.42, 155, 42, (1, 2.73, 4.12), .48, .34, 6),
    "blade": (.24, 980, 220, (1, 2.42, 3.81), .82, .63, 4),
    "bow": (.21, 440, 102, (1, 2, 5), .58, .92, 7),
    "shot": (.18, 165, 48, (1, 1.58), .94, .84, 9),
    "fire": (.48, 172, 68, (1, 1.49), .92, .23, 4),
    "ice": (.47, 1420, 830, (1, 1.49, 2.57), .24, .88, 5),
    "void": (.48, 265, 63, (1, 1.035, 1.49), .29, .18, 3),
    "spark": (.29, 940, 240, (1, 1.414, 2.36), .42, .69, 4),
    "ward": (.52, 390, 580, (1, 1.25, 1.5), .04, .24, 3),
    "impact": (.15, 130, 43, (1, 2.4), .68, .45, 7),
    "count": (.13, 620, 610, (1, 2), .0, .1, 4),
    "signal": (.32, 510, 850, (1, 1.5), .0, .1, 4),
}


def render(name, patch):
    duration, start, end, partials, noise, smooth, decay = patch
    rng = random.Random(name)
    phase = filtered = 0.0
    samples = []
    for i in range(round(duration * RATE)):
        t = i / RATE
        u = t / duration
        phase += math.tau * (end + (start - end) * (1 - u) ** 3) / RATE
        tone = sum(math.sin(phase * p) / (j + 1) for j, p in enumerate(partials))
        filtered += smooth * (rng.uniform(-1, 1) - filtered)
        env = min(1, t / .004, (duration - t) / .015) * math.exp(-decay * u)
        samples.append(env * ((1 - noise) * tone + noise * filtered))
    peak = max(map(abs, samples))
    pcm = array.array("h", (round(s * 23000 / peak) for s in samples))
    if sys.byteorder != "little":
        pcm.byteswap()
    with wave.open(str(DEST / (name + ".wav")), "wb") as out:
        out.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        out.writeframes(pcm.tobytes())


if __name__ == "__main__":
    DEST.mkdir(parents=True, exist_ok=True)
    for cue, parameters in PATCHES.items():
        render(cue, parameters)
