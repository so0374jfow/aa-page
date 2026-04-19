#!/usr/bin/env python3
"""
Spolia Wall — Element Writer

Adds a new element to the data/elements.json database.
Downloads seller images, assigns auto-incremented ID,
commits and pushes changes.

Usage:
  python add_element.py < element.json
  python add_element.py --file element.json
  python add_element.py --interactive
"""

import json
import os
import sys
import argparse
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from _slots import regenerate_slots

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
ELEMENTS_FILE = DATA_DIR / "elements.json"
IMAGES_DIR = DATA_DIR / "images"


def load_elements():
    """Load the current elements database."""
    if not ELEMENTS_FILE.exists():
        return {
            "metadata": {
                "total_elements": 0,
                "total_spend_chf": 0,
                "estimated_coverage_m2": 0,
                "last_updated": ""
            },
            "elements": []
        }
    with open(ELEMENTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_elements(data):
    """Write the elements database back to disk."""
    with open(ELEMENTS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def next_id(elements):
    """Generate the next auto-incremented element ID."""
    max_num = 0
    for el in elements:
        try:
            num = int(el["id"].split("-")[1])
            if num > max_num:
                max_num = num
        except (IndexError, ValueError):
            pass
    return f"EL-{max_num + 1:04d}"


def download_images(element_id, image_urls):
    """Download seller images and return local filenames."""
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    local_files = []

    for i, url in enumerate(image_urls, 1):
        ext = url.rsplit(".", 1)[-1].split("?")[0] if "." in url else "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        filename = f"{element_id}_{i:02d}.{ext}"
        filepath = IMAGES_DIR / filename

        try:
            print(f"  Downloading {url} -> {filename}")
            req = urllib.request.Request(url, headers={"User-Agent": "SpoliaWall/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                filepath.write_bytes(resp.read())
            local_files.append(filename)
        except (urllib.error.URLError, OSError) as e:
            print(f"  Warning: Failed to download {url}: {e}")
            local_files.append(filename)  # Record expected filename even if download fails

    return local_files


def calculate_coverage(element):
    """Estimate coverage in m² from dimensions."""
    dim = element.get("dimensions_actual") or element.get("dimensions_estimated")
    if dim and dim.get("width") and dim.get("height"):
        return (dim["width"] / 1000) * (dim["height"] / 1000)
    return 0


def git_commit_and_push(element):
    """Stage all changes, commit with standard format, and push."""
    os.chdir(REPO_ROOT)

    # Stage
    subprocess.run(["git", "add", "data/"], check=True)

    # Commit message format: STATUS EL-XXXX subcategory platform
    msg = f"{element['status']} {element['id']} {element['subcategory']} {element.get('platform', 'manual')}"
    subprocess.run(["git", "commit", "-m", msg], check=True)

    # Push
    subprocess.run(["git", "push"], check=True)
    print(f"  Committed and pushed: {msg}")


def add_element(new_element, commit=True):
    """Main function: add an element to the database."""
    db = load_elements()

    # Assign ID
    element_id = next_id(db["elements"])
    new_element["id"] = element_id
    print(f"Assigned ID: {element_id}")

    # Set timestamps
    now = datetime.now(timezone.utc).isoformat()
    new_element.setdefault("created_at", now)
    new_element["updated_at"] = now

    # Download images
    image_urls = new_element.get("images_original", [])
    if image_urls:
        new_element["images_local"] = download_images(element_id, image_urls)
    else:
        new_element.setdefault("images_local", [])

    # Set defaults
    new_element.setdefault("status", "SCOUTED")
    new_element.setdefault("mesh_url", None)
    new_element.setdefault("dimensions_actual", None)
    new_element.setdefault("architect_review_flag", False)
    new_element.setdefault("architect_notes", "")
    new_element.setdefault("agent_notes", "")

    # Append to database
    db["elements"].append(new_element)

    # Update metadata
    db["metadata"]["total_elements"] = len(db["elements"])
    total_spend = sum(el.get("total_chf", 0) or 0 for el in db["elements"])
    db["metadata"]["total_spend_chf"] = round(total_spend, 2)
    total_coverage = sum(calculate_coverage(el) for el in db["elements"])
    db["metadata"]["estimated_coverage_m2"] = round(total_coverage, 4)
    db["metadata"]["last_updated"] = now

    # Save
    save_elements(db)
    print(f"Saved {element_id} to {ELEMENTS_FILE}")

    # Repack the wall so the new element gets a committed slot.
    regenerate_slots()

    # Git commit and push
    if commit:
        try:
            git_commit_and_push(new_element)
        except subprocess.CalledProcessError as e:
            print(f"  Git error: {e}. Changes saved but not committed.")

    return element_id


def interactive_mode():
    """Interactively build an element record."""
    print("=== Spolia Wall — Add Element (Interactive) ===\n")

    el = {}
    el["status"] = input("Status [SCOUTED]: ").strip() or "SCOUTED"
    el["category"] = input("Category (CAT-A/B/C/D/E): ").strip()
    el["subcategory"] = input("Subcategory: ").strip()
    el["description"] = input("Description: ").strip()
    el["slot_id"] = input("Slot ID [null]: ").strip() or None

    w = input("Est. width (mm): ").strip()
    h = input("Est. height (mm): ").strip()
    d = input("Est. depth (mm): ").strip()
    if w and h and d:
        el["dimensions_estimated"] = {"width": int(w), "height": int(h), "depth": int(d)}

    el["platform"] = input("Platform: ").strip()
    el["listing_url"] = input("Listing URL: ").strip()
    el["seller_handle"] = input("Seller handle: ").strip()

    ask = input("Asking price CHF: ").strip()
    el["asking_price_chf"] = float(ask) if ask else None
    agreed = input("Agreed price CHF: ").strip()
    el["agreed_price_chf"] = float(agreed) if agreed else None
    ship = input("Shipping CHF: ").strip()
    el["shipping_cost_chf"] = float(ship) if ship else None
    if el["agreed_price_chf"] and el["shipping_cost_chf"]:
        el["total_chf"] = el["agreed_price_chf"] + el["shipping_cost_chf"]
    else:
        el["total_chf"] = None

    el["provenance_seller_text"] = input("Provenance (seller text): ").strip()
    el["negotiation_log"] = input("Negotiation log: ").strip()
    el["fire_classification"] = input("Fire classification [RF1]: ").strip() or "RF1"

    urls = input("Image URLs (comma-separated): ").strip()
    el["images_original"] = [u.strip() for u in urls.split(",") if u.strip()] if urls else []

    return el


def main():
    parser = argparse.ArgumentParser(description="Add an element to the Spolia Wall database")
    parser.add_argument("--file", "-f", help="JSON file containing element data")
    parser.add_argument("--interactive", "-i", action="store_true", help="Interactive mode")
    parser.add_argument("--no-commit", action="store_true", help="Don't git commit/push")
    args = parser.parse_args()

    if args.interactive:
        element_data = interactive_mode()
    elif args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            element_data = json.load(f)
    else:
        # Read from stdin
        element_data = json.load(sys.stdin)

    element_id = add_element(element_data, commit=not args.no_commit)
    print(f"\nDone. Element {element_id} added successfully.")


if __name__ == "__main__":
    main()
