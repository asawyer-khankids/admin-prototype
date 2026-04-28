#!/usr/bin/env python3
"""
Generate a synthetic computed_demo.json that mirrors the real computed.json
roster (same students, classes, schools, districts, scales) but replaces the
`levels` array with demo data showing clear growth from Fall 2025 to Spring 2026.

Design goals:
  - Most (but not all) students are assessed: ~94% in Fall, ~91% in Spring.
  - Per-scale ranks respect the scale's `modules` (supported age bands).
  - Spring ranks typically rise by 1 over Fall; some stay, a few jump 2,
    and a small minority dip (mirroring real assessment noise).
  - Per-grade Fall baselines: Pre-K 3 → mostly age 2-3, Pre-K 4 → 3-4,
    Kindergarten → 4.
  - Deterministic (seeded RNG) so the demo file is reproducible.
"""
from __future__ import annotations
import json
import random
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SEED = 20260427

# Per-grade Fall baseline rank distribution (rank 1-4). Spring baseline is
# computed from Fall via per-student growth.
FALL_BASELINE = {
    "Pre-K 3":     [0.45, 0.35, 0.15, 0.05],   # mostly age 2-3
    "Pre-K 4":     [0.10, 0.30, 0.40, 0.20],   # mostly age 3-4
    "Kindergarten":[0.05, 0.10, 0.30, 0.55],   # mostly KG
}

# Probability a student appears in a given window (assessed at least once).
P_FALL_ASSESSED   = 0.94
P_SPRING_ASSESSED = 0.91

# For each (student, scale) pair, probability the student has a level entry
# this window when the student is "assessed" overall. Modeling per-scale
# coverage so coverage gaps look natural across scales.
P_SCALE_COVERAGE = 0.85

# Spring growth distribution given a Fall rank (P[Δ rank]).
# Most kids gain 1 rank, some stay, a few gain 2, and a small minority dip.
GROWTH = [
    (-1, 0.05),
    ( 0, 0.20),
    (+1, 0.55),
    (+2, 0.18),
    (+3, 0.02),
]

def weighted_pick(rng: random.Random, weights):
    r = rng.random()
    acc = 0.0
    for i, w in enumerate(weights):
        acc += w
        if r <= acc:
            return i
    return len(weights) - 1


def pick_growth(rng: random.Random):
    r = rng.random()
    acc = 0.0
    for delta, p in GROWTH:
        acc += p
        if r <= acc:
            return delta
    return 1


def clamp_to_supported(rank: int, supported: list[int]) -> int:
    """Clip rank to nearest supported module (or 0 if no support)."""
    if not supported:
        return 0
    if rank in supported:
        return rank
    if rank < min(supported):
        return min(supported)
    if rank > max(supported):
        return max(supported)
    # Pick the closest supported rank
    return min(supported, key=lambda s: abs(s - rank))


def main():
    src = DATA_DIR / "computed.json"
    dst = DATA_DIR / "computed_demo.json"
    if not src.exists():
        raise SystemExit(f"Real data not found: {src}")

    with open(src) as f:
        raw = json.load(f)

    rng = random.Random(SEED)

    # Ensure both windows exist (we always emit growth fall → spring).
    if "Fall 2025" not in raw["windows"] or "Spring 2026" not in raw["windows"]:
        raise SystemExit("Expected both 'Fall 2025' and 'Spring 2026' in windows")
    fall_idx = raw["windows"].index("Fall 2025")
    spring_idx = raw["windows"].index("Spring 2026")

    students = raw["students"]
    scales = raw["scales"]
    classes_by_grp = {c["group_id"]: c for c in raw["classes"]}

    # Map student.language ('EN'/'SP') → expected scale.language
    lang_map = {"EN": "English", "SP": "Spanish"}

    levels: list[list[int]] = []
    for u_idx, stu in enumerate(students):
        cls = classes_by_grp.get(stu["group_id"])
        grade = (cls or {}).get("grade", "Pre-K 4")
        baseline = FALL_BASELINE.get(grade, FALL_BASELINE["Pre-K 4"])
        stu_lang = lang_map.get(stu.get("language"), "English")

        # Eligible scales: those matching the student's language.
        eligible = [(s_idx, sc) for s_idx, sc in enumerate(scales) if sc.get("language") == stu_lang]

        in_fall = rng.random() < P_FALL_ASSESSED
        in_spring = rng.random() < P_SPRING_ASSESSED

        for s_idx, sc in eligible:
            supported = sc.get("modules") or [1, 2, 3, 4]

            fall_rank = 0
            if in_fall and rng.random() < P_SCALE_COVERAGE:
                # Pick rank from baseline weights, then clamp to supported.
                raw_rank = weighted_pick(rng, baseline) + 1   # 1..4
                fall_rank = clamp_to_supported(raw_rank, supported)
                if fall_rank > 0:
                    levels.append([u_idx, s_idx, fall_idx, fall_rank])

            if in_spring and rng.random() < P_SCALE_COVERAGE:
                if fall_rank > 0:
                    spring_rank = fall_rank + pick_growth(rng)
                else:
                    # No fall data → fresh draw from baseline + small uplift.
                    spring_rank = weighted_pick(rng, baseline) + 1 + (1 if rng.random() < 0.6 else 0)
                spring_rank = max(1, min(4, spring_rank))
                spring_rank = clamp_to_supported(spring_rank, supported)
                if spring_rank > 0:
                    levels.append([u_idx, s_idx, spring_idx, spring_rank])

    out = dict(raw)
    out["levels"] = levels
    out["generated_at"] = datetime.now(timezone.utc).isoformat()
    out["demo"] = True

    with open(dst, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    # Quick summary
    fall_count = sum(1 for _, _, w, _ in levels if w == fall_idx)
    spring_count = sum(1 for _, _, w, _ in levels if w == spring_idx)
    print(f"Wrote {dst}")
    print(f"  students: {len(students)}, scales: {len(scales)}")
    print(f"  fall entries:   {fall_count:,}")
    print(f"  spring entries: {spring_count:,}")
    print(f"  total entries:  {len(levels):,}")


if __name__ == "__main__":
    main()
