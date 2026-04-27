#!/usr/bin/env python3
"""
QA breakdown — writes a wide CSV with one row per (student, scale, window) showing
every step of the Learning Zone calculation. Mirrors the scoring logic in
preprocess.py exactly so you can verify intermediate numbers against Rowzero.

Output columns:
  student_name, grade, class, school, district,
  scale_code, scale_name, domain, language, window,
  2YO_attempted, 2YO_correct, 2YO_cutoff, 2YO_passed,
  3YO_attempted, 3YO_correct, 3YO_cutoff, 3YO_passed,
  4YO_attempted, 4YO_correct, 4YO_cutoff, 4YO_passed,
  KG_attempted,  KG_correct,  KG_cutoff,  KG_passed,
  learning_zone

For ATL (Executive Function) scales the modules are L1/L2/L3/L4; they're
mapped to the 2YO/3YO/4YO/KG columns by rank. Same for Language's L*YO modules.
"""
from __future__ import annotations
import argparse
import csv
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

MODULE_RANK = {
    "2YO": 1, "3YO": 2, "4YO": 3, "KG": 4,
    "L2YO": 1, "L3YO": 2, "L4YO": 3, "LKG": 4,
    "L1": 1, "L2": 2, "L3": 3, "L4": 4,
}
RANK_LABEL = {0: "Not Assessed", 1: "2YO Skills", 2: "3YO Skills", 3: "4YO Skills", 4: "Kindergarten Skills"}

GRADE_RE = re.compile(r"(Pre-K\s*\d|Kindergarten)")


def window_for(ts_iso: str) -> Optional[str]:
    # Two-window scheme:
    #   Fall 2025:   Aug 1, 2025  – Dec 31, 2025
    #   Spring 2026: Jan 1, 2026  – Apr 27, 2026
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


def grade_from_class(name: str) -> str:
    if "Kindergarten" in name:
        return "Kindergarten"
    m = re.search(r"Pre-K\s*(\d)", name)
    return f"Pre-K {m.group(1)}" if m else ""


def load_dim(path: Path, key: str, value: str) -> dict[str, str]:
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            out[row[key]] = row[value]
    return out


def load_scales(path: Path) -> dict[str, dict]:
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            lp = row["Assessment"]
            domain = row["Domain"].strip()
            if not domain:
                continue
            fname = lp.rsplit("/", 1)[-1].replace(".asm", "")
            i = 0
            while i < len(fname) and (fname[i].isalpha() or fname[i].isdigit()):
                if i > 0 and fname[i].isupper() and (fname[i - 1].isdigit() or fname[i - 1].islower()):
                    break
                i += 1
            code = fname[:i]
            name_chars = []
            for j, ch in enumerate(fname[i:]):
                if j > 0 and ch.isupper():
                    name_chars.append(" ")
                name_chars.append(ch)
            name = "".join(name_chars).strip() or code
            out[lp] = {"code": code, "name": name, "domain": domain, "language": row["Language"]}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True, help="Path to raw items CSV")
    ap.add_argument("--out", default=str(DATA_DIR / "qa_breakdown.csv"))
    ap.add_argument("--user-id", default=None,
                    help="Optional: filter to a single user_id")
    ap.add_argument("--student-name", default=None,
                    help="Optional: filter to a single student name (case-insensitive substring)")
    args = ap.parse_args()

    items_path = Path(args.items)
    if not items_path.exists():
        sys.exit(f"Items CSV not found: {items_path}")

    print("Loading dims and scales...")
    students = load_dim(DATA_DIR / "dim_students.csv", "user_id", "student name")
    classes = load_dim(DATA_DIR / "dim_classes.csv", "group_id", "class name")
    schools = load_dim(DATA_DIR / "dim_schools.csv", "school_id", "school name")
    districts = load_dim(DATA_DIR / "dim_districts.csv", "district_id", "district name")
    scales = load_scales(DATA_DIR / "scale_to_domain.csv")

    target_uid = args.user_id
    target_name = args.student_name.lower() if args.student_name else None
    if target_name:
        # Resolve to a user_id
        match = [uid for uid, n in students.items() if target_name in n.lower()]
        if not match:
            sys.exit(f"No student name matching '{args.student_name}'")
        if len(match) > 1:
            print(f"Note: {len(match)} students matched '{args.student_name}'. Including all.")
        target_uids = set(match)
    elif target_uid:
        target_uids = {target_uid}
    else:
        target_uids = None

    # Pass: per (uid, leaf_path, window, module, item) -> max score (per-student joined to roster).
    print(f"Reading {items_path.name}...")
    best: dict[tuple, dict[str, int]] = defaultdict(dict)
    seen_user_meta: dict[str, dict[str, str]] = {}
    with open(items_path, newline="") as f:
        for n, row in enumerate(csv.DictReader(f), 1):
            if not row["item"].startswith("q"):
                continue
            uid = row["user_id"]
            if target_uids is not None and uid not in target_uids:
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
            mod = row["module"]
            item = row["item"]
            key = (uid, lp, win, mod)
            prev = best[key].get(item)
            if prev is None or score > prev:
                best[key][item] = score
            seen_user_meta[uid] = {
                "group_id": row["group_id"],
                "school_id": row["school_id"],
                "district_id": row["district_id"],
            }
            if n % 200000 == 0:
                print(f"    {n:,} rows...")
    print(f"  unique (user, scale, window, module) groups: {len(best):,}")

    # Group by (uid, leaf_path, window) → {rank: {attempted, correct, cutoff, passed}}
    by_uvs: dict[tuple, dict[int, dict]] = defaultdict(
        lambda: {1: None, 2: None, 3: None, 4: None}
    )
    for (uid, lp, win, mod), items_map in best.items():
        rank = MODULE_RANK.get(mod, 0)
        if rank == 0:
            continue
        attempted = len(items_map)
        if attempted == 0:
            continue
        correct = sum(1 for s in items_map.values() if s == 100)
        cutoff = max(1, attempted - 2)
        passed = correct >= cutoff
        prev = by_uvs[(uid, lp, win)][rank]
        # If multiple module codes mapped to the same rank (rare; preserve "passed" if any did)
        if prev is None:
            by_uvs[(uid, lp, win)][rank] = {
                "attempted": attempted,
                "correct": correct,
                "cutoff": cutoff,
                "passed": passed,
            }
        else:
            # Merge — take max attempts/correct, OR passed
            by_uvs[(uid, lp, win)][rank] = {
                "attempted": max(prev["attempted"], attempted),
                "correct": max(prev["correct"], correct),
                "cutoff": min(prev["cutoff"], cutoff),
                "passed": prev["passed"] or passed,
            }

    def learning_zone(per_rank: dict) -> int:
        for r in (1, 2, 3, 4):
            if per_rank[r] and not per_rank[r]["passed"]:
                return r
        # No fails. Highest passed rank
        highest = 0
        for r in (1, 2, 3, 4):
            if per_rank[r] and per_rank[r]["passed"]:
                highest = r
        if highest == 0:
            return 0
        return min(4, highest + 1)

    print("Writing breakdown CSV...")
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "student_name", "grade", "class", "school", "district",
        "scale_code", "scale_name", "domain", "language", "window",
        "2YO_attempted", "2YO_correct", "2YO_cutoff", "2YO_passed",
        "3YO_attempted", "3YO_correct", "3YO_cutoff", "3YO_passed",
        "4YO_attempted", "4YO_correct", "4YO_cutoff", "4YO_passed",
        "KG_attempted",  "KG_correct",  "KG_cutoff",  "KG_passed",
        "learning_zone",
    ]
    rank_label_for_col = {1: "2YO", 2: "3YO", 3: "4YO", 4: "KG"}

    with open(out_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        # Sort: by student name, scale code, window
        sorted_keys = sorted(
            by_uvs.keys(),
            key=lambda k: (
                students.get(k[0], "").lower(),
                scales.get(k[1], {}).get("code", ""),
                k[2],
            ),
        )
        for (uid, lp, win) in sorted_keys:
            per_rank = by_uvs[(uid, lp, win)]
            sc = scales[lp]
            meta = seen_user_meta.get(uid, {})
            cls = classes.get(meta.get("group_id", ""), "")
            sch = schools.get(meta.get("school_id", ""), "")
            dis = districts.get(meta.get("district_id", ""), "")
            row = {
                "student_name": students.get(uid, ""),
                "grade": grade_from_class(cls),
                "class": cls,
                "school": sch,
                "district": dis,
                "scale_code": sc["code"],
                "scale_name": sc["name"],
                "domain": sc["domain"],
                "language": sc["language"],
                "window": win,
            }
            for r in (1, 2, 3, 4):
                lbl = rank_label_for_col[r]
                e = per_rank[r]
                if e is None:
                    row[f"{lbl}_attempted"] = ""
                    row[f"{lbl}_correct"] = ""
                    row[f"{lbl}_cutoff"] = ""
                    row[f"{lbl}_passed"] = ""
                else:
                    row[f"{lbl}_attempted"] = e["attempted"]
                    row[f"{lbl}_correct"] = e["correct"]
                    row[f"{lbl}_cutoff"] = e["cutoff"]
                    row[f"{lbl}_passed"] = "PASS" if e["passed"] else "FAIL"
            row["learning_zone"] = RANK_LABEL[learning_zone(per_rank)]
            w.writerow(row)

    print(f"Wrote {out_path} ({len(by_uvs):,} rows)")
    if target_uids:
        print(f"Filtered to {len(target_uids)} student(s).")


if __name__ == "__main__":
    main()
