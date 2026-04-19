"""
Shared helper: run the parametric slot generator and sync elements.json.

After any mutation to elements.json (add, status change, assignment), call
regenerate_slots() to repack the wall so committed slots track real objects.
The helper also rewrites each element's slot_id to match its newly assigned
committed slot (or None if the element is no longer eligible / placeable),
keeping elements.json and slots.json consistent.
"""

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
GENERATOR = REPO_ROOT / "app" / "generate_slots.mjs"
ELEMENTS_FILE = REPO_ROOT / "data" / "elements.json"
SLOTS_FILE = REPO_ROOT / "data" / "slots.json"


def regenerate_slots(status_floor: str = "ASSESSED") -> bool:
    """Repack the wall from elements.json. Returns True on success."""
    if not GENERATOR.exists():
        print(f"  Slot generator not found at {GENERATOR}, skipping repack")
        return False

    cmd = ["node", str(GENERATOR), "--status-floor", status_floor]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    except FileNotFoundError:
        print("  node not available on PATH, skipping repack")
        return False
    except subprocess.CalledProcessError as e:
        print(f"  Slot generator failed: {e.stderr.strip()}")
        return False

    SLOTS_FILE.write_text(result.stdout, encoding="utf-8")
    if result.stderr:
        for line in result.stderr.strip().splitlines():
            print(f"  [slots] {line}")

    _sync_element_slot_ids()
    return True


def _sync_element_slot_ids() -> None:
    """Make elements.json agree with slots.json about slot_id bindings."""
    slots_db = json.loads(SLOTS_FILE.read_text(encoding="utf-8"))
    elements_db = json.loads(ELEMENTS_FILE.read_text(encoding="utf-8"))

    element_to_slot = {}
    for slot in slots_db.get("slots", []):
        eid = slot.get("element_id")
        if eid:
            element_to_slot[eid] = slot["id"]

    changed = 0
    for el in elements_db.get("elements", []):
        new_slot = element_to_slot.get(el["id"])
        if el.get("slot_id") != new_slot:
            el["slot_id"] = new_slot
            changed += 1

    if changed:
        with open(ELEMENTS_FILE, "w", encoding="utf-8") as f:
            json.dump(elements_db, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"  Synced slot_id on {changed} element(s)")
