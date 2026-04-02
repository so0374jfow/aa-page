#!/usr/bin/env python3
"""
Spolia Wall — 3D Mesh Generator

Generates GLB meshes from element images using fal.ai TripoSR API.
Triggered when elements are APPROVED or auto-assessed with high confidence.

Usage:
  python generate_mesh.py EL-0001                     # Generate for one element
  python generate_mesh.py --auto                       # Generate for all eligible
  python generate_mesh.py EL-0001 --image-url URL      # Override image source

Requires: FAL_API_KEY environment variable
"""

import json
import os
import sys
import time
import argparse
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
ELEMENTS_FILE = DATA_DIR / "elements.json"
MESHES_DIR = DATA_DIR / "meshes"
IMAGES_DIR = DATA_DIR / "images"

FAL_TRIPOSR_URL = "https://fal.run/fal-ai/triposr"
MAX_GLB_SIZE_MB = 5


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


def get_api_key():
    key = os.environ.get("FAL_API_KEY")
    if not key:
        print("Error: FAL_API_KEY environment variable not set")
        print("  Get your key at https://fal.ai/dashboard/keys")
        sys.exit(1)
    return key


def is_eligible(element):
    """
    Check if element is eligible for mesh generation.
    Eligible when:
    - Status is APPROVED or later (NEGOTIATING, PURCHASED, SHIPPED, RECEIVED, ALLOCATED, INSTALLED)
    - OR status is ASSESSED and architect_review_flag is False (high-confidence auto-approval)
    And:
    - Has at least one image
    - Does not already have a mesh
    """
    if element.get("mesh_url"):
        return False  # Already has mesh

    has_image = bool(element.get("images_local")) or bool(element.get("images_original"))
    if not has_image:
        return False

    status = element.get("status", "")
    post_approval = status in (
        "APPROVED", "NEGOTIATING", "PURCHASED", "SHIPPED",
        "RECEIVED", "ALLOCATED", "INSTALLED"
    )
    auto_approved = status == "ASSESSED" and not element.get("architect_review_flag", True)

    return post_approval or auto_approved


def get_image_url(element, override_url=None):
    """Get the best image URL for mesh generation."""
    if override_url:
        return override_url

    # Try original URLs first (direct HTTP access)
    originals = element.get("images_original", [])
    if originals:
        return originals[0]

    # Fall back to local images via raw.githubusercontent.com
    locals_ = element.get("images_local", [])
    if locals_:
        owner = os.environ.get("GITHUB_OWNER", "so0374jfow")
        repo = os.environ.get("GITHUB_REPO", "aa-page")
        branch = os.environ.get("GITHUB_BRANCH", "main")
        return f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/data/images/{locals_[0]}"

    return None


def call_triposr(image_url, api_key):
    """
    Call fal.ai TripoSR API to generate a 3D mesh from an image.
    Returns the URL of the generated GLB file.
    """
    payload = json.dumps({
        "image_url": image_url,
        "output_format": "glb",
        "do_remove_background": True,
        "foreground_ratio": 0.9,
        "mc_resolution": 256
    }).encode("utf-8")

    req = urllib.request.Request(
        FAL_TRIPOSR_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Key {api_key}",
            "User-Agent": "SpoliaWall/1.0"
        },
        method="POST"
    )

    print(f"  Calling TripoSR API...")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  API error {e.code}: {body}")
        return None
    except urllib.error.URLError as e:
        print(f"  Network error: {e}")
        return None

    # Extract GLB URL from response
    model_mesh = result.get("model_mesh", {})
    glb_url = model_mesh.get("url")
    if not glb_url:
        print(f"  Error: No model_mesh URL in response: {json.dumps(result, indent=2)}")
        return None

    file_size = model_mesh.get("file_size", 0)
    print(f"  Generated mesh: {file_size} bytes")

    if file_size > MAX_GLB_SIZE_MB * 1024 * 1024:
        print(f"  Warning: GLB is {file_size / 1024 / 1024:.1f}MB (max {MAX_GLB_SIZE_MB}MB)")

    return glb_url


def download_glb(url, output_path):
    """Download GLB file from URL."""
    MESHES_DIR.mkdir(parents=True, exist_ok=True)

    req = urllib.request.Request(url, headers={"User-Agent": "SpoliaWall/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read()
            output_path.write_bytes(data)
            print(f"  Saved: {output_path.name} ({len(data)} bytes)")
            return True
    except (urllib.error.URLError, OSError) as e:
        print(f"  Download error: {e}")
        return False


def generate_mesh(element_id, db=None, override_url=None, commit=True):
    """Generate a 3D mesh for a single element."""
    if db is None:
        db = load_db()

    el = find_element(db, element_id)
    if not el:
        print(f"Error: Element {element_id} not found")
        return False

    if el.get("mesh_url") and not override_url:
        print(f"{element_id}: Already has mesh at {el['mesh_url']}")
        return True

    api_key = get_api_key()
    image_url = get_image_url(el, override_url)
    if not image_url:
        print(f"{element_id}: No image available for mesh generation")
        return False

    print(f"Generating mesh for {element_id}...")
    print(f"  Image: {image_url}")

    # Call API
    glb_url = call_triposr(image_url, api_key)
    if not glb_url:
        return False

    # Download GLB
    output_path = MESHES_DIR / f"{element_id}.glb"
    if not download_glb(glb_url, output_path):
        return False

    # Update element record
    el["mesh_url"] = f"data/meshes/{element_id}.glb"
    el["updated_at"] = datetime.now(timezone.utc).isoformat()
    db["metadata"]["last_updated"] = el["updated_at"]

    save_db(db)
    print(f"{element_id}: Mesh generated successfully")

    # Git commit
    if commit:
        try:
            os.chdir(REPO_ROOT)
            subprocess.run(["git", "add", "data/"], check=True)
            msg = f"MESH {element_id} {el.get('subcategory', '')} generated"
            subprocess.run(["git", "commit", "-m", msg], check=True)
            subprocess.run(["git", "push"], check=True)
            print(f"  Committed and pushed: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"  Git error: {e}. Changes saved but not committed.")

    return True


def auto_generate(commit=True):
    """Generate meshes for all eligible elements."""
    db = load_db()
    eligible = [el for el in db["elements"] if is_eligible(el)]

    if not eligible:
        print("No eligible elements for mesh generation")
        return

    print(f"Found {len(eligible)} eligible elements")
    success = 0
    for el in eligible:
        if generate_mesh(el["id"], db=db, commit=commit):
            success += 1
        time.sleep(1)  # Rate limiting

    print(f"\nGenerated {success}/{len(eligible)} meshes")


def main():
    parser = argparse.ArgumentParser(description="Generate 3D meshes for Spolia Wall elements")
    parser.add_argument("element_id", nargs="?", help="Element ID (e.g., EL-0001)")
    parser.add_argument("--auto", action="store_true", help="Generate for all eligible elements")
    parser.add_argument("--image-url", help="Override image URL for generation")
    parser.add_argument("--no-commit", action="store_true", help="Don't git commit/push")
    args = parser.parse_args()

    if args.auto:
        auto_generate(commit=not args.no_commit)
    elif args.element_id:
        generate_mesh(args.element_id, override_url=args.image_url, commit=not args.no_commit)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
