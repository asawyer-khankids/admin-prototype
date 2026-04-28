#!/usr/bin/env python3
"""
Preprocess raw assessment-attempt data for the admin-report-prototype.

Inputs (relative to repo root):
  data/scale_to_domain.csv      leaf_path -> {domain, language}
  data/dim_districts.csv        district_id -> name
  data/dim_schools.csv          school_id -> name
  data/dim_classes.csv          group_id -> class name
  data/dim_students.csv         user_id -> student name

  Items CSV (path passed via --items, e.g. /Users/.../analytics_042726.csv):
    columns: user_id, group_id, school_id, district_id, domain, language_,
             leaf_index, leaf_path, module, item, score, duration,
             timestamp_local, retry_key

Output:
  data/computed.json   compact pre-aggregated structure consumed by script.js

Scoring rules (matches the user's walkthrough on MAT8V2):
  * q-items only count (rows where item starts with 'q'); p* practice items are skipped.
  * For each (user, leaf_path, module, item), keep the HIGHEST score across all
    attempts. A "correct" answer is score == 100.
  * Per-student per-module pass/fail: pass if correct_q_items >= attempted - 2
    (with a floor of 1). The cutoff is per-student because assessments are adaptive
    and different students see different q-item subsets.
  * Per-(user, leaf_path, window) Learning Zone (the prototype's "level"):
      0 = Not Assessed         (no q-items attempted in any module)
      1 = 2YO Skills           (failed at 2YO, the first module attempted)
      2 = 3YO Skills           (passed 2YO, failed at 3YO; or jumped in at 3YO and failed)
      3 = 4YO Skills           (passed 3YO, failed at 4YO; or skipped to 4YO and failed)
      4 = Kindergarten Skills  (passed 4YO, failed/working on KG; or passed KG → cap at 4)
    "First failed module wins"; modules not attempted by an older student (because
    the test placed them higher) are treated as passed-by-placement.

Module normalization:
  Math/Literacy use age-band module codes directly: 2YO/3YO/4YO/KG.
  Language scales use L-prefixed equivalents: L2YO/L3YO/L4YO/LKG.
  Executive Function (ATL*) scales use numeric levels L1/L2/L3/L4 mapped to
  rank 1/2/3/4 (so L1==2YO, L2==3YO, L3==4YO, L4==KG).
"""
from __future__ import annotations
import argparse
import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

# Module rank: 1..4 maps to age-band 2YO..KG; 0 means "not assessed".
MODULE_RANK = {
    # Math + Literacy
    "2YO": 1, "3YO": 2, "4YO": 3, "KG": 4,
    # Language
    "L2YO": 1, "L3YO": 2, "L4YO": 3, "LKG": 4,
    # Executive Function (numeric levels)
    "L1": 1, "L2": 2, "L3": 3, "L4": 4,
}
RANK_TO_LEVEL_LABEL = {
    0: "Not Assessed",
    1: "2YO Skills",
    2: "3YO Skills",
    3: "4YO Skills",
    4: "KG Skills",
}

# Window membership rules (two-window scheme for the 25-26 school year):
#   Fall 2025:   Aug 1, 2025  – Dec 31, 2025
#   Spring 2026: Jan 1, 2026  – Apr 27, 2026
# Anything outside both ranges is dropped.
def window_for(ts_iso: str) -> Optional[str]:
    # Accepts "2026-03-09 09:06:57+00" or "2026-03-09 09:06:57+00:00"
    s = ts_iso.replace(" ", "T")
    if s.endswith("+00"):
        s = s + ":00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    d = dt.date()
    if datetime(2025, 8, 1).date() <= d <= datetime(2025, 12, 31).date():
        return "Fall 2025"
    if datetime(2026, 1, 1).date() <= d <= datetime(2026, 4, 27).date():
        return "Spring 2026"
    return None


def load_dim(path: Path, key: str, value: str) -> dict[str, str]:
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            out[row[key]] = row[value]
    return out


def load_scales(path: Path) -> dict[str, dict]:
    """leaf_path -> {domain, language, code, name}"""
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            lp = row["Assessment"]
            domain = row["Domain"].strip()
            if not domain:
                continue  # skip FTU and similar
            # Derive a short scale code + display name from the filename, e.g.
            # "USGK/Library/Assessments/EN/MAT4MoreOrLess.asm" -> code "MAT4", name "More Or Less"
            fname = lp.rsplit("/", 1)[-1].replace(".asm", "")
            # Split prefix codes from display:
            # MAT3, MAT6a, MAT6b, LIT1a, LIT3bi, LIT3bii, LAN6, LAN7a, LAN7b, ATL5a, ...
            i = 0
            while i < len(fname) and (fname[i].isalpha() or fname[i].isdigit()):
                # Stop when we hit an uppercase letter that looks like the start of a name word
                # following a number or lowercase: e.g. "MAT4MoreOrLess" -> stop after the digit/lowercase run
                # Heuristic: code ends when we see an uppercase letter that follows a digit or is the
                # 2nd+ uppercase in a row at boundary.
                if (
                    i > 0
                    and fname[i].isupper()
                    and (fname[i - 1].isdigit() or fname[i - 1].islower())
                ):
                    break
                i += 1
            code = fname[:i]
            display_words = fname[i:]
            # Insert spaces before uppercase letters in the display
            name_chars = []
            for j, ch in enumerate(display_words):
                if j > 0 and ch.isupper():
                    name_chars.append(" ")
                name_chars.append(ch)
            name = "".join(name_chars).strip() or code
            out[lp] = {
                "leaf_path": lp,
                "code": code,
                "name": name,
                "domain": domain,
                "language": row["Language"],
            }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--items",
        required=True,
        help="Path to the raw items CSV (analytics_*.csv from Rowzero export)",
    )
    ap.add_argument("--out", default=str(DATA_DIR / "computed.json"))
    args = ap.parse_args()

    items_path = Path(args.items)
    if not items_path.exists():
        sys.exit(f"Items CSV not found: {items_path}")

    print(f"Loading dims and scales from {DATA_DIR}/...")
    students = load_dim(DATA_DIR / "dim_students.csv", "user_id", "student name")
    classes = load_dim(DATA_DIR / "dim_classes.csv", "group_id", "class name")
    schools = load_dim(DATA_DIR / "dim_schools.csv", "school_id", "school name")
    districts = load_dim(DATA_DIR / "dim_districts.csv", "district_id", "district name")
    scales = load_scales(DATA_DIR / "scale_to_domain.csv")
    print(
        f"  {len(students)} students, {len(classes)} classes, {len(schools)} schools, "
        f"{len(districts)} districts, {len(scales)} scales"
    )

    # Pass 1: collect all q-item codes per (leaf_path, module) to know totals.
    print(f"Pass 1: scanning {items_path.name} for module item totals...")
    total_items: dict[tuple[str, str], set[str]] = defaultdict(set)
    student_to_class: dict[str, str] = {}
    student_to_school: dict[str, str] = {}
    student_to_district: dict[str, str] = {}
    class_to_school: dict[str, str] = {}
    school_to_district: dict[str, str] = {}
    languages_seen = set()

    with open(items_path, newline="") as f:
        for n, row in enumerate(csv.DictReader(f), 1):
            if not row["item"].startswith("q"):
                continue
            lp = row["leaf_path"]
            if lp not in scales:
                continue
            total_items[(lp, row["module"])].add(row["item"])

            # Capture roster relationships from the items data itself
            uid = row["user_id"]
            gid = row["group_id"]
            sid = row["school_id"]
            did = row["district_id"]
            student_to_class.setdefault(uid, gid)
            student_to_school.setdefault(uid, sid)
            student_to_district.setdefault(uid, did)
            class_to_school.setdefault(gid, sid)
            school_to_district.setdefault(sid, did)
            lang = row["language_"]
            if lang == "ES":
                lang = "SP"  # normalize
            languages_seen.add(lang)
            if n % 200000 == 0:
                print(f"    {n:,} rows...")
    print(f"  module totals: {len(total_items)} (leaf_path, module) pairs")

    # Pass 2: per (user, leaf_path, window, module, item) keep the HIGHEST score
    # across all attempts. p-items (practice) are skipped; only q-items count.
    print("Pass 2: aggregating HIGHEST score per (user, scale, window, module, item)...")
    # best[(user, leaf_path, window, module)][item] = max_score
    best: dict[tuple, dict[str, int]] = defaultdict(dict)
    user_languages: dict[str, set[str]] = defaultdict(set)

    with open(items_path, newline="") as f:
        for n, row in enumerate(csv.DictReader(f), 1):
            if not row["item"].startswith("q"):
                continue
            lp = row["leaf_path"]
            if lp not in scales:
                continue
            win = window_for(row["timestamp_local"])
            if win is None:
                continue
            try:
                score = int(row["score"])
            except ValueError:
                continue
            uid = row["user_id"]
            mod = row["module"]
            item = row["item"]
            key = (uid, lp, win, mod)
            prev = best[key].get(item)
            if prev is None or score > prev:
                best[key][item] = score
            lang = row["language_"]
            if lang == "ES":
                lang = "SP"
            user_languages[uid].add(lang)
            if n % 200000 == 0:
                print(f"    {n:,} rows...")
    print(f"  unique (user, scale, window, module) groups: {len(best):,}")

    # Pass 3: for each (user, scale, window), determine pass/fail per module-rank
    # (1=2YO, 2=3YO, 3=4YO, 4=KG), then compute the Learning Zone:
    #   - First attempted module that the student FAILED → that's the zone.
    #   - If all attempted modules passed, zone = (highest_passed_rank + 1), capped at 4.
    #   - If no modules attempted at all, zone = 0 (Not Assessed).
    # Modules NOT attempted (e.g., the test placed an older student straight into 3YO)
    # are treated as passed-by-placement.
    print("Pass 3: pass/fail per module + Learning Zone per (user, scale, window)...")
    user_ids = sorted({uid for (uid, _, _, _) in best})
    user_idx = {uid: i for i, uid in enumerate(user_ids)}
    scale_keys = sorted({lp for (_, lp, _, _) in best})
    scale_idx = {lp: i for i, lp in enumerate(scale_keys)}
    window_keys = sorted({w for (_, _, w, _) in best})
    window_idx = {w: i for i, w in enumerate(window_keys)}

    # Build per-(user, scale, window) → {rank: True/False/None}
    per_uvs: dict[tuple, dict[int, "bool|None"]] = defaultdict(
        lambda: {1: None, 2: None, 3: None, 4: None}
    )
    for (uid, lp, win, mod), items_map in best.items():
        rank = MODULE_RANK.get(mod, 0)
        if rank == 0:
            continue  # unknown module code
        attempted = len(items_map)
        if attempted == 0:
            continue
        cutoff = max(1, attempted - 2)
        correct = sum(1 for s in items_map.values() if s == 100)
        passed = correct >= cutoff
        key = (user_idx[uid], scale_idx[lp], window_idx[win])
        # If a rank was attempted multiple times (e.g., separate L1+L2YO), prefer pass over fail
        prev = per_uvs[key][rank]
        if prev is None:
            per_uvs[key][rank] = passed
        else:
            per_uvs[key][rank] = prev or passed

    def learning_zone(per_rank: dict) -> int:
        # First failed module wins
        for r in (1, 2, 3, 4):
            if per_rank[r] is False:
                return r
        # No fails. Find highest passed rank (some may be None if not attempted).
        highest = 0
        for r in (1, 2, 3, 4):
            if per_rank[r] is True:
                highest = r
        if highest == 0:
            return 0  # nothing attempted (shouldn't happen since per_uvs only has entries when something was)
        return min(4, highest + 1)

    user_scale_window: dict[tuple[int, int, int], int] = {}
    for key, per_rank in per_uvs.items():
        user_scale_window[key] = learning_zone(per_rank)
    passed_any = sum(1 for r in user_scale_window.values() if r > 0)
    print(
        f"  (user, scale, window) entries with a Learning Zone: {len(user_scale_window):,} "
        f"({passed_any:,} non-zero)"
    )

    # Build output
    print("Building output JSON...")

    def class_grade_from_name(name: str) -> str:
        # "Ms. Johnson's Pre-K 3" -> "Pre-K 3"; "Mr. Smith's Pre-K 4" -> "Pre-K 4";
        # "Ms. ...'s Kindergarten" -> "Kindergarten"
        for token in ("Pre-K 3", "Pre-K 4", "Kindergarten"):
            if token in name:
                return token
        return ""

    out_users = []
    for uid in user_ids:
        gid = student_to_class.get(uid, "")
        sid = student_to_school.get(uid, "")
        did = student_to_district.get(uid, "")
        # Prefer a single canonical language for the student (most-attempted).
        langs = user_languages.get(uid, set())
        if "EN" in langs and "SP" in langs:
            lang = "EN"
        elif langs:
            lang = next(iter(langs))
        else:
            lang = "EN"
        out_users.append(
            {
                "user_id": uid,
                "name": students.get(uid, ""),
                "group_id": gid,
                "school_id": sid,
                "district_id": did,
                "language": lang,
            }
        )

    # Roster lookups: include only entities that actually appear in items data,
    # plus their grade for classes.
    out_classes = []
    seen_groups = sorted({s["group_id"] for s in out_users if s["group_id"]})
    for gid in seen_groups:
        nm = classes.get(gid, "")
        out_classes.append(
            {
                "group_id": gid,
                "name": nm,
                "grade": class_grade_from_name(nm),
                "school_id": class_to_school.get(gid, ""),
            }
        )

    out_schools = []
    seen_schools = sorted({s["school_id"] for s in out_users if s["school_id"]})
    for sid in seen_schools:
        out_schools.append(
            {
                "school_id": sid,
                "name": schools.get(sid, ""),
                "district_id": school_to_district.get(sid, ""),
            }
        )

    out_districts = []
    seen_districts = sorted({s["district_id"] for s in out_users if s["district_id"]})
    for did in seen_districts:
        out_districts.append({"district_id": did, "name": districts.get(did, "")})

    # For each leaf_path: derive the set of supported module ranks (1-4) from the
    # modules observed in the items data. Used by the prototype to mark cells as
    # N/A for scales that don't test a particular age band (e.g., MAT6a Add only
    # tests 4YO + KG, so its 2YO and 3YO cells should show a dashed N/A indicator).
    scale_supported_ranks: dict[str, set[int]] = defaultdict(set)
    for (lp, mod), items_set in total_items.items():
        if not items_set:
            continue
        rank = MODULE_RANK.get(mod, 0)
        if rank > 0:
            scale_supported_ranks[lp].add(rank)

    out_scales = []
    for lp in scale_keys:
        s = scales[lp]
        out_scales.append(
            {
                "leaf_path": lp,
                "code": s["code"],
                "name": s["name"],
                "domain": s["domain"],
                "language": s["language"],
                "modules": sorted(scale_supported_ranks.get(lp, set())),
            }
        )

    # Levels as a flat array of [u_idx, s_idx, w_idx, rank] for compact JSON.
    levels = [
        [u, s, w, r] for (u, s, w), r in sorted(user_scale_window.items())
    ]

    out = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "windows": list(window_keys),
        "level_labels": RANK_TO_LEVEL_LABEL,
        "students": out_users,
        "classes": out_classes,
        "schools": out_schools,
        "districts": out_districts,
        "scales": out_scales,
        "levels": levels,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    size_kb = out_path.stat().st_size / 1024
    print(f"Wrote {out_path} ({size_kb:,.1f} KB)")
    print(
        f"Summary: {len(out_users):,} students, {len(out_classes)} classes, "
        f"{len(out_schools)} schools, {len(out_districts)} districts, "
        f"{len(out_scales)} scales, {len(levels):,} level entries, "
        f"windows={out['windows']}"
    )


if __name__ == "__main__":
    main()
