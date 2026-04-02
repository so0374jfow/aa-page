# CLAUDE.md — Spolia Wall

AI assistant guidance for the `aa-page` repository.

## What This Is

A web app that visualises a 20m x 2m 3D wall made of hundreds of sourced physical objects. An AI procurement agent (Beatrice) finds objects on European marketplaces, negotiates, buys, and tracks them. The web app shows the wall in real time — each purchase appears as a coloured block. Click any block to see the full provenance story.

Everything runs on GitHub: JSON files as database, GitHub Actions for CI/CD, GitHub Pages for hosting.

## Project Structure

```
aa-page/
├── CLAUDE.md                    # This file
├── app/                         # Vite + Three.js frontend
│   ├── index.html
│   ├── package.json             # Only deps: three, vite
│   ├── vite.config.js           # base: '/aa-page/' for GH Pages
│   └── src/
│       ├── main.js              # Entry point, render loop, keyboard shortcuts
│       ├── scene.js             # Three.js scene, camera, controls, lighting
│       ├── wall.js              # Slot grid rendering, animations, pulses
│       ├── data.js              # Polling from raw.githubusercontent.com, diffing
│       ├── panel.js             # Click-to-detail HTML overlay panel
│       ├── hud.js               # Top-left stats HUD
│       ├── composition.js       # 5 composition rules, violation overlay
│       ├── colors.js            # Status + category colour maps
│       └── style.css            # All styling (panel, HUD, lightbox)
├── agent/
│   └── add_element.py           # Python script: add element, download images, git commit
├── data/
│   ├── elements.json            # Element records + metadata (the "database")
│   ├── slots.json               # Wall grid definition (20 slots, 3 faces)
│   └── images/                  # Downloaded seller images (EL-XXXX_01.jpg)
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

## Key Conventions

### Dependencies

**Only two npm packages allowed: `three` and `vite`.** No React, no Vue, no framework. If something seems to need a third package, ask before adding it.

### Data Model

- **Elements** (`data/elements.json`): Each object has ID `EL-XXXX`, status (11 states), category (CAT-A through CAT-E), dimensions, provenance, negotiation log, images, pricing in CHF
- **Slots** (`data/slots.json`): Wall grid positions with type (A/B/C), face (north/east/west), fire zone (1/2/3), adjacency list
- **Images**: Stored in-repo at `data/images/EL-XXXX_01.jpg`

### Status Pipeline

SCOUTED → ASSESSED → PENDING_REVIEW → APPROVED → NEGOTIATING → PURCHASED → SHIPPED → RECEIVED → ALLOCATED → INSTALLED (terminal). REJECTED reachable from any state.

### Colour System

- **Empty slots**: dark wireframe (`0x1a1a1a`)
- **Filled, not installed**: status colour (grey → yellow → orange → green → purple)
- **Installed**: category colour (terracotta, steel blue, teal, amber, warm sand)
- **PENDING_REVIEW**: pulses yellow

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
- Every status change = one commit (git log becomes procurement diary)
- GitHub Actions deploys on any push to `main` touching `app/` or `data/`

## Common Commands

```bash
cd app && npm run dev       # Dev server
cd app && npm run build     # Production build → app/dist/
python agent/add_element.py --interactive   # Add element interactively
python agent/add_element.py < element.json  # Add from JSON
```

## Notes for AI Assistants

- Read relevant source files before making changes
- Do not add npm dependencies — only `three` and `vite` are permitted
- The data model is the source of truth; the 3D view is derived from it
- All DOM for panel/HUD is vanilla JS — no templating libraries
- Scale: 1mm = 0.001 Three.js units (wall is 20 units long x 2 units high)
- Keep changes focused and minimal — avoid unrelated refactors
