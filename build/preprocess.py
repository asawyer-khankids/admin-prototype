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

Scoring rules (intentionally simple while real cutoffs aren't finalized):
  * q-items only count (rows where item starts with 'q'); p-items are filtered out.
  * For each (user, leaf_path, module) within a window, take the LATEST attempt per
    item by timestamp_local. A correct answer is score == 100.
  * Module-passed if correct_count >= total_q_items_in_module - 2, where
    total_q_items_in_module is the number of distinct q-item codes observed for that
    (leaf_path, module) across the full dataset.
  * Per-(user, leaf_path, window) level = highest module passed, mapped to a 0-4
    scale: 0 = Not Assessed, 1 = 2YO, 2 = 3YO, 3 = 4YO, 4 = KG.

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

# Window membership rules (fixed per SPEC):
#   Fall {Y}: 09/01..11/30 of year Y
#   Winter {Y}: 12/01..02/28 of year Y..Y+1 (still labeled Winter Y)
#   Spring {Y+1}: 03/01..05/15 of year Y+1
def window_for(ts_iso: str) -> Optional[str]:
    # Accepts "2026-03-09 09:06:57+00" or "2026-03-09 09:06:57+00:00"
    s = ts_iso.replace(" ", "T")
    # Tolerate "+00" trailing (no minutes)
    if s.endswith("+00"):
        s = s + ":00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    y, m, d = dt.year, dt.month, dt.day
    if 9 <= m <= 11:
        return f"Fall {y}"
    if m == 12:
        return f"Winter {y}"
    if 1 <= m <= 2:
        # Winter spans Dec Y .. Feb Y+1; we label by the start year.
        return f"Winter {y - 1}"
    if 3 <= m <= 5 and (m < 5 or d <= 15):
        # Spring runs Mar 1 .. May 15
        return f"Spring {y}"
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

    # Pass 2: per (user, leaf_path, module, item) keep latest attempt by timestamp.
    print("Pass 2: aggregating latest attempts per (user, scale, module, item)...")
    # latest[(user, leaf_path, window, module)][item] = (score, ts)
    latest: dict[tuple, dict[str, tuple[int, str]]] = defaultdict(dict)
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
            ts = row["timestamp_local"]
            key = (uid, lp, win, mod)
            existing = latest[key].get(item)
            if existing is None or ts > existing[1]:
                latest[key][item] = (score, ts)
            lang = row["language_"]
            if lang == "ES":
                lang = "SP"
            user_languages[uid].add(lang)
            if n % 200000 == 0:
                print(f"    {n:,} rows...")
    print(f"  unique (user, scale, window, module) groups: {len(latest):,}")

    # Pass 3: for each (user, scale, window), determine highest module passed.
    # Every (user, scale, window) where any q-item was attempted gets an entry.
    # rank = 0 means "attempted but no module passed"; rank 1-4 = highest module passed.
    #
    # Cutoff is PER-STUDENT (not dataset-wide). Assessments are adaptive: different
    # students see different q-item subsets. So the cutoff should be relative to what
    # the individual student actually attempted: cutoff = max(1, attempted - 2).
    print("Pass 3: scoring modules + computing per-(user, scale, window) level...")
    user_ids = sorted({uid for (uid, _, _, _) in latest})
    user_idx = {uid: i for i, uid in enumerate(user_ids)}
    scale_keys = sorted({lp for (_, lp, _, _) in latest})
    scale_idx = {lp: i for i, lp in enumerate(scale_keys)}
    window_keys = sorted({w for (_, _, w, _) in latest})
    window_idx = {w: i for i, w in enumerate(window_keys)}

    # Initialize every attempted (user, scale, window) at rank 0; promote up as modules pass.
    user_scale_window: dict[tuple[int, int, int], int] = {}
    for (uid, lp, win, _mod) in latest.keys():
        key = (user_idx[uid], scale_idx[lp], window_idx[win])
        user_scale_window.setdefault(key, 0)

    promoted = 0
    for (uid, lp, win, mod), items_map in latest.items():
        student_attempts = len(items_map)  # distinct q-items the student actually saw
        if student_attempts == 0:
            continue
        cutoff = max(1, student_attempts - 2)
        correct = sum(1 for (s, _ts) in items_map.values() if s == 100)
        if correct < cutoff:
            continue
        rank = MODULE_RANK.get(mod, 0)
        if rank == 0:
            continue
        key = (user_idx[uid], scale_idx[lp], window_idx[win])
        if rank > user_scale_window[key]:
            user_scale_window[key] = rank
            promoted += 1
    passed_count = sum(1 for r in user_scale_window.values() if r > 0)
    print(
        f"  attempted (user, scale, window) entries: {len(user_scale_window):,} "
        f"({passed_count:,} passed at least one module)"
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
