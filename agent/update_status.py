#!/usr/bin/env python3
"""
Spolia Wall — Status Transition

Moves an element through the procurement pipeline.
Every status change = one git commit.

Usage:
  python update_status.py EL-0001 ASSESSED
  python update_status.py EL-0001 PURCHASED --agreed-price 35 --shipping 22.50
  python update_status.py EL-0001 REJECTED --agent-notes "Seller unresponsive"
  python update_status.py EL-0001 NEGOTIATING --append-log "Antoine: Can you do 30€?"
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

VALID_STATUSES = [
    "SCOUTED", "ASSESSED", "PENDING_REVIEW", "APPROVED",
    "NEGOTIATING", "PURCHASED", "SHIPPED", "RECEIVED",
    "ALLOCATED", "INSTALLED", "REJECTED"
]

# Valid forward transitions (REJECTED is reachable from any state)
TRANSITIONS = {
    "SCOUTED":        ["ASSESSED", "REJECTED"],
    "ASSESSED":       ["PENDING_REVIEW", "APPROVED", "REJECTED"],
    "PENDING_REVIEW": ["APPROVED", "REJECTED"],
    "APPROVED":       ["NEGOTIATING", "REJECTED"],
    "NEGOTIATING":    ["PURCHASED", "REJECTED"],
    "PURCHASED":      ["SHIPPED", "REJECTED"],
    "SHIPPED":        ["RECEIVED", "REJECTED"],
    "RECEIVED":       ["ALLOCATED", "REJECTED"],
    "ALLOCATED":      ["INSTALLED", "REJECTED"],
    "INSTALLED":      [],
    "REJECTED":       []
}


def load_db():
    with open(ELEMENTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_db(db):
    with open(ELEMENTS_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
        f.write("\n")


def find_element(db, element_id):
    for el in db["elements"]:
        if el["id"] == element_id:
            return el
    return None


def update_metadata(db):
    db["metadata"]["total_elements"] = len(db["elements"])
    db["metadata"]["total_spend_chf"] = round(
        sum(el.get("total_chf", 0) or 0 for el in db["elements"]), 2
    )
    coverage = 0
    for el in db["elements"]:
        dim = el.get("dimensions_actual") or el.get("dimensions_estimated")
        if dim and dim.get("width") and dim.get("height"):
            coverage += (dim["width"] / 1000) * (dim["height"] / 1000)
    db["metadata"]["estimated_coverage_m2"] = round(coverage, 4)
    db["metadata"]["last_updated"] = datetime.now(timezone.utc).isoformat()


def git_commit_and_push(element):
    os.chdir(REPO_ROOT)
    subprocess.run(["git", "add", "data/"], check=True)
    msg = f"{element['status']} {element['id']} {element.get('subcategory', '')} {element.get('platform', 'manual')}"
    subprocess.run(["git", "commit", "-m", msg], check=True)
    subprocess.run(["git", "push"], check=True)
    print(f"  Committed and pushed: {msg}")


def main():
    parser = argparse.ArgumentParser(description="Update element status in the Spolia Wall")
    parser.add_argument("element_id", help="Element ID (e.g., EL-0001)")
    parser.add_argument("new_status", help=f"New status: {', '.join(VALID_STATUSES)}")
    parser.add_argument("--agreed-price", type=float, help="Set agreed price (CHF)")
    parser.add_argument("--shipping", type=float, help="Set shipping cost (CHF)")
    parser.add_argument("--agent-notes", help="Set agent notes")
    parser.add_argument("--append-log", help="Append to negotiation log")
    parser.add_argument("--flag-review", action="store_true", help="Flag for architect review")
    parser.add_argument("--fire-class", help="Set fire classification (e.g., RF1, RF3)")
    parser.add_argument("--no-commit", action="store_true", help="Don't git commit/push")
    parser.add_argument("--force", action="store_true", help="Skip transition validation")
    args = parser.parse_args()

    if args.new_status not in VALID_STATUSES:
        print(f"Error: Invalid status '{args.new_status}'. Valid: {', '.join(VALID_STATUSES)}")
        sys.exit(1)

    db = load_db()
    el = find_element(db, args.element_id)
    if not el:
        print(f"Error: Element {args.element_id} not found")
        sys.exit(1)

    old_status = el["status"]

    # Validate transition
    if not args.force:
        allowed = TRANSITIONS.get(old_status, [])
        if args.new_status not in allowed:
            print(f"Error: Cannot transition from {old_status} to {args.new_status}")
            print(f"  Allowed transitions: {', '.join(allowed) if allowed else 'none (terminal state)'}")
            print(f"  Use --force to override")
            sys.exit(1)

    # Apply status change
    el["status"] = args.new_status
    el["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Apply optional field updates
    if args.agreed_price is not None:
        el["agreed_price_chf"] = args.agreed_price
        if el.get("shipping_cost_chf"):
            el["total_chf"] = args.agreed_price + el["shipping_cost_chf"]

    if args.shipping is not None:
        el["shipping_cost_chf"] = args.shipping
        if el.get("agreed_price_chf"):
            el["total_chf"] = el["agreed_price_chf"] + args.shipping

    if args.agent_notes:
        el["agent_notes"] = args.agent_notes

    if args.append_log:
        existing = el.get("negotiation_log", "")
        el["negotiation_log"] = existing + "\n" + args.append_log if existing else args.append_log

    if args.flag_review:
        el["architect_review_flag"] = True

    if args.fire_class:
        el["fire_classification"] = args.fire_class

    update_metadata(db)
    save_db(db)
    print(f"{args.element_id}: {old_status} → {args.new_status}")

    # Status changes flip elements in and out of the committed-slot pool
    # (e.g. SCOUTED → ASSESSED brings them in; → REJECTED removes them).
    regenerate_slots()

    if not args.no_commit:
        try:
            git_commit_and_push(el)
        except subprocess.CalledProcessError as e:
            print(f"  Git error: {e}. Changes saved but not committed.")


if __name__ == "__main__":
    main()
