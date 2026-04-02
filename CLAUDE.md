# CLAUDE.md — Spolia Wall

AI assistant guidance for the `aa-page` repository.

## What This Is

A web app that visualises a 20m x 2m 3D wall made of hundreds of sourced physical objects. An AI procurement agent (Antoine) finds objects on European marketplaces, negotiates, buys, and tracks them. The web app shows the wall in real time — each purchase appears as a coloured block (or a 3D mesh when generated). Click any block to see the full provenance story.

Everything runs on GitHub: JSON files as database, GitHub Actions for CI/CD, GitHub Pages for hosting.

## Project Structure

```
aa-page/
├── CLAUDE.md                    # This file
├── app/                         # Vite + Three.js frontend
│   ├── index.html
│   ├── package.json             # Only deps: three, vite
│   ├── vite.config.js           # base: '/aa-page/' for GH Pages
│   ├── generate_slots.mjs       # Slot grid generator script
│   └── src/
│       ├── main.js              # Entry point, render loop, keyboard shortcuts
│       ├── scene.js             # Three.js scene, camera, controls, lighting
│       ├── wall.js              # Slot grid rendering, GLB loading, animations
│       ├── data.js              # Polling from raw.githubusercontent.com, diffing
│       ├── panel.js             # Click-to-detail HTML overlay panel
│       ├── hud.js               # Top-left stats HUD
│       ├── composition.js       # 5 composition rules, violation overlay
│       ├── colors.js            # Status + category colour maps
│       └── style.css            # All styling (panel, HUD, lightbox)
├── agent/
│   ├── add_element.py           # Add new element, download images, git commit
│   ├── update_status.py         # Status transitions with validation
│   ├── assign_slot.py           # Slot assignment with composition rule checks
│   └── generate_mesh.py         # 3D mesh generation via fal.ai TripoSR
├── data/
│   ├── elements.json            # Element records + metadata (the "database")
│   ├── slots.json               # Wall grid definition (~1400 slots, 3 faces)
│   ├── images/                  # Downloaded seller images (EL-XXXX_01.jpg)
│   └── meshes/                  # Generated GLB meshes (EL-XXXX.glb)
├── docs/                        # Protocol and brief documents
└── .github/workflows/
    └── deploy.yml               # Auto-deploy on push to main
```

## Getting Started

```bash
cd app
npm install
npm run dev        # Vite dev server at localhost:5173
```

Data files are copied to `app/public/data/` during build. In dev mode, `loadLocalData()` fetches from relative paths.

## Agent Pipeline

Antoine (the procurement agent) uses four scripts in `agent/`:

### Add a new element
```bash
python agent/add_element.py < element.json          # From JSON
python agent/add_element.py --interactive            # Interactive prompts
python agent/add_element.py --file element.json      # From file
```
Auto-assigns ID (EL-XXXX), downloads seller images, updates metadata, commits and pushes.

### Update element status
```bash
python agent/update_status.py EL-0001 ASSESSED
python agent/update_status.py EL-0001 PURCHASED --agreed-price 35 --shipping 22.50
python agent/update_status.py EL-0001 NEGOTIATING --append-log "Antoine: Can you do 30€?"
python agent/update_status.py EL-0001 PENDING_REVIEW --flag-review
```
Validates transitions (cannot skip steps or leave terminal states). Use `--force` to override.

### Assign element to wall slot
```bash
python agent/assign_slot.py EL-0001 SLOT-N-042
python agent/assign_slot.py EL-0001 SLOT-N-042 --force   # Skip composition checks
python agent/assign_slot.py --unassign EL-0001            # Remove from slot
```
Checks all 5 composition rules before assignment. Updates both elements.json and slots.json atomically.

### Generate 3D mesh
```bash
export FAL_API_KEY=your_key_here
python agent/generate_mesh.py EL-0001                     # Single element
python agent/generate_mesh.py --auto                       # All eligible elements
python agent/generate_mesh.py EL-0001 --image-url URL      # Override image
```
Calls fal.ai TripoSR to generate GLB from element photos. Eligible when APPROVED (or ASSESSED with no review flag). GLB stored in `data/meshes/`. The Three.js app loads GLBs and scales them to fit the element's actual dimensions.

## Key Conventions

### Dependencies

**Only two npm packages allowed: `three` and `vite`.** No React, no Vue, no framework. If something seems to need a third package, ask before adding it.

**Python agent scripts use only stdlib** (json, urllib, subprocess, pathlib, argparse). No pip dependencies.

### Data Model

- **Elements** (`data/elements.json`): Each object has ID `EL-XXXX`, status (11 states), category (CAT-A through CAT-E), dimensions, provenance, negotiation log, images, pricing in CHF, mesh_url
- **Slots** (`data/slots.json`): Wall grid positions with type (A/B/C), face (north/east/west), fire zone (1/2/3), adjacency list
- **Images**: Stored in-repo at `data/images/EL-XXXX_01.jpg`
- **Meshes**: Generated GLBs at `data/meshes/EL-XXXX.glb` (via fal.ai TripoSR)

### Status Pipeline

SCOUTED → ASSESSED → PENDING_REVIEW → APPROVED → NEGOTIATING → PURCHASED → SHIPPED → RECEIVED → ALLOCATED → INSTALLED (terminal). REJECTED reachable from any state.

### 3D Mesh Pipeline

Elements become eligible for mesh generation when:
- Status reaches APPROVED (architect greenlit), OR
- Status is ASSESSED and `architect_review_flag` is false (high-confidence auto-approval)

The generated GLB is scaled to the element's most accurate dimensions (`dimensions_actual` if measured, otherwise `dimensions_estimated`). The app falls back to a colored box if no mesh exists or loading fails.

### Colour System

- **Empty slots**: light wireframe (`0xcccccc`)
- **Filled, not installed**: status colour (grey → yellow → orange → green → purple)
- **Installed**: category colour (terracotta, steel blue, teal, amber, warm sand)
- **PENDING_REVIEW**: pulses yellow
- **With GLB mesh**: same colour applied to mesh materials

### Composition Rules (checked on every assignment)

1. No same subcategory adjacent
2. No same category adjacent
3. CAT-D surrounded by CAT-A/CAT-B on all sides
4. Adjacent slots differ by ≥20mm depth
5. Fire zone compliance (CAT-D only Zone 1 unless encapsulated; Zone 3: only CAT-A, CAT-B)

### Fire Zones

- Zone 1 (0–3m): all categories permitted
- Zone 2 (3–6m): CAT-D excluded unless encapsulated
- Zone 3 (6m+): only CAT-A, CAT-B; CAT-C needs MDS

### Keyboard Shortcuts

`C` composition overlay | `A` axes | `R` refresh | `F` fit camera | `Esc` close panel

## Git Conventions

- Agent commits follow format: `STATUS EL-XXXX subcategory platform`
- Mesh commits: `MESH EL-XXXX subcategory generated`
- Slot assignment: `ALLOCATED EL-XXXX subcategory → SLOT-X-XXX`
- Every status change = one commit (git log becomes procurement diary)
- GitHub Actions deploys on any push to `main` touching `app/` or `data/`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FAL_API_KEY` | For mesh generation | fal.ai API key (https://fal.ai/dashboard/keys) |
| `GITHUB_OWNER` | Optional | Override repo owner (default: so0374jfow) |
| `GITHUB_REPO` | Optional | Override repo name (default: aa-page) |
| `GITHUB_BRANCH` | Optional | Override branch (default: main) |

## Common Commands

```bash
cd app && npm run dev                                # Dev server
cd app && npm run build                              # Production build → app/dist/
python agent/add_element.py --interactive            # Add element interactively
python agent/update_status.py EL-0001 PURCHASED      # Update status
python agent/assign_slot.py EL-0001 SLOT-N-042       # Assign to slot
python agent/generate_mesh.py --auto                  # Generate all eligible meshes
node app/generate_slots.mjs > data/slots.json        # Regenerate slot grid
```

## Notes for AI Assistants

- Read relevant source files before making changes
- Do not add npm dependencies — only `three` and `vite` are permitted
- The data model is the source of truth; the 3D view is derived from it
- All DOM for panel/HUD is vanilla JS — no templating libraries
- Scale: 1mm = 0.001 Three.js units (wall is 20 units long x 1 unit high)
- GLB meshes are loaded async with box fallback — never block rendering
- Keep changes focused and minimal — avoid unrelated refactors
