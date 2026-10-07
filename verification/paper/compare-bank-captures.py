import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
FRAMES = {"O37", "O37a", "O37b", "O37c", "O37d", "O37e"}


def checkout_path(value):
    path = (ROOT / value).resolve()
    path.relative_to(ROOT)
    return path


def image_bytes(path, expected_hash):
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()

    if digest != expected_hash:
        raise ValueError(f"Changed image hash: {path.relative_to(ROOT)}")

    with Image.open(path) as image:
        if image.format != "PNG" or image.size != (1440, 900):
            raise ValueError(f"Expected a complete 1440 x 900 PNG: {path.relative_to(ROOT)}")

        rgba = image.convert("RGBA")

        if rgba.getextrema()[3] != (255, 255):
            raise ValueError(f"Whole-frame images must be opaque: {path.relative_to(ROOT)}")

        return rgba.tobytes(), digest


def compare(entry, output, strict):
    expected_path = checkout_path(entry["expected"])
    actual_path = checkout_path(entry["actual"])
    expected, expected_hash = image_bytes(expected_path, entry["expectedSha256"])
    actual, actual_hash = image_bytes(actual_path, entry["actualSha256"])
    diff = bytearray(expected)
    bad = 0
    hotspots = Counter()

    for offset in range(0, len(actual), 4):
        delta = max(abs(actual[offset + channel] - expected[offset + channel]) for channel in range(3))
        hit = delta > 24

        if hit:
            bad += 1
            pixel = offset // 4
            hotspots[f"x{pixel % 1440 // 120 * 120},y{pixel // 1440 // 100 * 100}"] += 1
            diff[offset:offset + 4] = bytes((220, 30, 30, 255))
        else:
            diff[offset + 3] = 90

    filename = f"{entry['frame']}.diff.png"
    Image.frombytes("RGBA", (1440, 900), bytes(diff)).save(output / filename)
    ratio = bad / (1440 * 900)

    return {
        "frame": entry["frame"],
        "expected": entry["expected"],
        "actual": entry["actual"],
        "expectedSha256": expected_hash,
        "actualSha256": actual_hash,
        "diff": str((output / filename).relative_to(ROOT)),
        "differentPixels": bad,
        "diffRatio": ratio,
        "maxDiffRatio": entry["maxDiffRatio"],
        "comparison": "strictly_less_than" if strict else "less_than_or_equal",
        "pass": ratio < entry["maxDiffRatio"] if strict else ratio <= entry["maxDiffRatio"],
        "hotspots": hotspots.most_common(8),
    }


def main():
    manifest_path = checkout_path(sys.argv[1])
    output = checkout_path(sys.argv[2])
    manifest = json.loads(manifest_path.read_text())
    entries = manifest["entries"]

    if manifest["viewport"] != {"width": 1440, "height": 900} or manifest["pixelTolerance"] != 24:
        raise ValueError("Retain the approved full viewport and 24-level pixel tolerance")

    if len(entries) != 6 or {entry["frame"] for entry in entries} != FRAMES:
        raise ValueError("Exactly one capture of each approved state is required")

    decision_path = manifest.get("thresholdDecision")
    strict = decision_path is not None
    limit = 0.025 if strict else 0.01

    if strict:
        expected_decision = "docs/plans/evidence/bank-review-parity-20261007/threshold-decision.json"

        if decision_path != expected_decision:
            raise ValueError("Unknown bank parity threshold authority")

        decision = json.loads(checkout_path(decision_path).read_text())

        if (set(decision["frames"]) != FRAMES or decision["maxDiffRatio"] != limit
                or decision["comparison"] != "strictly_less_than"
                or decision["viewport"] != manifest["viewport"]
                or decision["pixelTolerance"] != manifest["pixelTolerance"]
                or decision["baselineChanges"] or decision["captureChanges"]):
            raise ValueError("Inconsistent scoped bank parity threshold decision")

    if any(entry["maxDiffRatio"] != limit for entry in entries):
        raise ValueError("Manifest limits must match the scoped threshold authority")

    output.mkdir(parents=True, exist_ok=True)
    results = [compare(entry, output, strict) for entry in entries]
    report = {"thresholdDecision": decision_path, "manifest": str(manifest_path.relative_to(ROOT)), "pixelTolerance": 24, "viewport": manifest["viewport"], "entries": results, "pass": all(entry["pass"] for entry in results), "scope": "Pixel comparison only; source identity and behavior require independent proof"}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"pass": report["pass"], "states": [{"frame": entry["frame"], "diffRatio": round(entry["diffRatio"], 4), "pass": entry["pass"]} for entry in results]}))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
