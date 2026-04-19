#!/usr/bin/env python3
"""
Spolia Wall — Slot Assignment

Assigns an element to a wall slot with composition rule validation.
Updates both elements.json and slots.json atomically.

Usage:
  python assign_slot.py EL-0001 SLOT-N-042
  python assign_slot.py EL-0001 SLOT-N-042 --force    # Skip composition checks
  python assign_slot.py --unassign EL-0001             # Remove from slot
"""

import json
import sys
import argparse
import subprocess
import os
from datetime import datetime, timezone
from pathlib import Path

from _slots import regenerate_slots

REPO_ROOT = Path(__file__).resolve().parent.parent
ELEMENTS_FILE = REPO_ROOT / "data" / "elements.json"
SLOTS_FILE = REPO_ROOT / "data" / "slots.json"


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def find_element(db, element_id):
    for el in db["elements"]:
        if el["id"] == element_id:
            return el
    return None


def find_slot(slots_db, slot_id):
    for s in slots_db["slots"]:
        if s["id"] == slot_id:
            return s
    return None


def get_element_for_slot(db, slot_id):
    """Find the element assigned to a slot."""
    for el in db["elements"]:
        if el.get("slot_id") == slot_id:
            return el
    return None


def check_composition_rules(db, slots_db, element, slot):
    """
    Check all 5 composition rules. Returns list of violation descriptions.
    Empty list = all rules pass.
    """
    violations = []
    adjacent_ids = slot.get("adjacent", [])

    # Gather adjacent elements
    adj_elements = []
    for adj_id in adjacent_ids:
        adj_el = get_element_for_slot(db, adj_id)
        if adj_el:
            adj_slot = find_slot(slots_db, adj_id)
            adj_elements.append((adj_el, adj_slot))

    # Rule 1: No same subcategory adjacent
    for adj_el, _ in adj_elements:
        if element.get("subcategory") == adj_el.get("subcategory"):
            violations.append(
                f"Rule 1: Same subcategory '{element['subcategory']}' adjacent to {adj_el['id']}"
            )

    # Rule 2: No same category adjacent
    for adj_el, _ in adj_elements:
        if element.get("category") == adj_el.get("category"):
            violations.append(
                f"Rule 2: Same category '{element['category']}' adjacent to {adj_el['id']}"
            )

    # Rule 3: CAT-D must be surrounded by CAT-A or CAT-B on all sides
    if element.get("category") == "CAT-D":
        for adj_id in adjacent_ids:
            adj_el = get_element_for_slot(db, adj_id)
            if adj_el is None:
                violations.append(
                    f"Rule 3: CAT-D requires all adjacent slots filled with CAT-A/CAT-B, "
                    f"but {adj_id} is empty"
                )
            elif adj_el.get("category") not in ("CAT-A", "CAT-B"):
                violations.append(
                    f"Rule 3: CAT-D adjacent to {adj_el['id']} ({adj_el['category']}), "
                    f"needs CAT-A or CAT-B"
                )

    # Rule 4: Adjacent slots must differ by ≥20mm depth
    el_depth = 0
    dim = element.get("dimensions_actual") or element.get("dimensions_estimated")
    if dim:
        el_depth = dim.get("depth", 0)

    for adj_el, adj_slot in adj_elements:
        adj_dim = adj_el.get("dimensions_actual") or adj_el.get("dimensions_estimated")
        adj_depth = adj_dim.get("depth", 0) if adj_dim else 0
        diff = abs(el_depth - adj_depth)
        if diff < 20:
            violations.append(
                f"Rule 4: Depth difference with {adj_el['id']} is {diff}mm (needs ≥20mm)"
            )

    # Rule 5: Fire zone compliance
    zone = slot.get("fire_zone", 1)
    cat = element.get("category", "")
    fire_class = element.get("fire_classification", "")

    if zone == 3:
        if cat == "CAT-D":
            violations.append("Rule 5: CAT-D not permitted in Zone 3")
        if cat == "CAT-E":
            violations.append("Rule 5: CAT-E not permitted in Zone 3")
        if cat == "CAT-C" and fire_class != "RF1":
            violations.append(f"Rule 5: CAT-C in Zone 3 needs RF1 (has '{fire_class}')")
    elif zone == 2:
        if cat == "CAT-D" and fire_class != "RF1":
            violations.append(
                f"Rule 5: CAT-D in Zone 2 needs RF1 encapsulation (has '{fire_class}')"
            )

    return violations


def git_commit_and_push(element, slot):
    os.chdir(REPO_ROOT)
    subprocess.run(["git", "add", "data/"], check=True)
    msg = f"ALLOCATED {element['id']} {element.get('subcategory', '')} → {slot['id']}"
    subprocess.run(["git", "commit", "-m", msg], check=True)
    subprocess.run(["git", "push"], check=True)
    print(f"  Committed and pushed: {msg}")


def main():
    parser = argparse.ArgumentParser(description="Assign element to wall slot")
    parser.add_argument("element_id", help="Element ID (e.g., EL-0001)")
    parser.add_argument("slot_id", nargs="?", help="Slot ID (e.g., SLOT-N-042)")
    parser.add_argument("--unassign", action="store_true", help="Remove element from its slot")
    parser.add_argument("--force", action="store_true", help="Skip composition rule checks")
    parser.add_argument("--no-commit", action="store_true", help="Don't git commit/push")
    args = parser.parse_args()

    db = load_json(ELEMENTS_FILE)
    slots_db = load_json(SLOTS_FILE)

    el = find_element(db, args.element_id)
    if not el:
        print(f"Error: Element {args.element_id} not found")
        sys.exit(1)

    # Unassign mode
    if args.unassign:
        old_slot_id = el.get("slot_id")
        if not old_slot_id:
            print(f"{args.element_id} is not assigned to any slot")
            sys.exit(0)

        # Clear element's slot reference
        el["slot_id"] = None
        el["status"] = "RECEIVED"  # Back to pre-allocation status
        el["updated_at"] = datetime.now(timezone.utc).isoformat()

        # Clear slot's element reference
        old_slot = find_slot(slots_db, old_slot_id)
        if old_slot:
            old_slot["status"] = "empty"
            old_slot["element_id"] = None

        save_json(ELEMENTS_FILE, db)
        save_json(SLOTS_FILE, slots_db)
        print(f"{args.element_id}: Unassigned from {old_slot_id}")

        # Repack — the unassigned element is still eligible for a committed
        # slot (status was ALLOCATED/INSTALLED) unless its status was changed
        # by a different flow. Regenerate so the wall reflects reality.
        regenerate_slots()

        if not args.no_commit:
            os.chdir(REPO_ROOT)
            subprocess.run(["git", "add", "data/"], check=True)
            msg = f"UNASSIGN {args.element_id} from {old_slot_id}"
            subprocess.run(["git", "commit", "-m", msg], check=True)
            subprocess.run(["git", "push"], check=True)
        return

    # Assignment mode
    if not args.slot_id:
        print("Error: slot_id required for assignment (or use --unassign)")
        sys.exit(1)

    slot = find_slot(slots_db, args.slot_id)
    if not slot:
        print(f"Error: Slot {args.slot_id} not found")
        sys.exit(1)

    if slot["element_id"] and slot["element_id"] != args.element_id:
        print(f"Error: Slot {args.slot_id} already assigned to {slot['element_id']}")
        sys.exit(1)

    # Check if element is already assigned elsewhere
    if el.get("slot_id") and el["slot_id"] != args.slot_id:
        old_slot = find_slot(slots_db, el["slot_id"])
        if old_slot:
            old_slot["status"] = "empty"
            old_slot["element_id"] = None
        print(f"  Moved from {el['slot_id']} → {args.slot_id}")

    # Composition rule checks
    if not args.force:
        violations = check_composition_rules(db, slots_db, el, slot)
        if violations:
            print(f"Composition rule violations for {args.element_id} → {args.slot_id}:")
            for v in violations:
                print(f"  ✗ {v}")
            print(f"\nUse --force to assign anyway.")
            sys.exit(1)

    # Apply assignment
    el["slot_id"] = args.slot_id
    el["status"] = "ALLOCATED"
    el["updated_at"] = datetime.now(timezone.utc).isoformat()

    slot["status"] = "assigned"
    slot["element_id"] = args.element_id

    # Update metadata
    db["metadata"]["last_updated"] = el["updated_at"]

    save_json(ELEMENTS_FILE, db)
    save_json(SLOTS_FILE, slots_db)
    print(f"{args.element_id}: Assigned to {args.slot_id} (face: {slot['face']}, zone: {slot['fire_zone']})")

    # Repack — the packer will honour the story hint from the slot_id just
    # written, but the exact position is fluid (committed slots are auto-laid
    # out). Manual assignment pins the story, not the pixel.
    regenerate_slots()

    if not args.no_commit:
        try:
            git_commit_and_push(el, slot)
        except subprocess.CalledProcessError as e:
            print(f"  Git error: {e}. Changes saved but not committed.")


if __name__ == "__main__":
    main()
