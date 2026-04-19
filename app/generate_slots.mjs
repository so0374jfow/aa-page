// Generate slots.json — parametric spolia packing
//
// Two-pass bitmap packing:
//   1. Committed pass — reads data/elements.json. Every element past the
//      status floor with a known width/height is packed as a real rectangle
//      and bound to its element_id. Committed slots have stable IDs
//      (SLOT-L{story}-EL{XXXX}) so they survive repacks.
//   2. Filler pass — the old random-shard behaviour fills remaining empty
//      bitmap space with speculative slots (SLOT-L{story}-F{NNN}) that
//      future scouting can claim.
//
// Deterministic: Math.random is replaced by a mulberry32 PRNG seeded from
// a hash of elements.json, so repeated runs on the same catalogue produce
// identical output (no git noise).
//
// Run: node generate_slots.mjs > ../data/slots.json
//      node generate_slots.mjs --status-floor APPROVED > ../data/slots.json
//
// Balcony heights come from data/models/building_config.json when present.

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATUS_ORDER = [
  'SCOUTED', 'ASSESSED', 'PENDING_REVIEW', 'APPROVED',
  'NEGOTIATING', 'PURCHASED', 'SHIPPED', 'RECEIVED',
  'ALLOCATED', 'INSTALLED'
];

function parseArgs(argv) {
  const args = { statusFloor: 'ASSESSED' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--status-floor') args.statusFloor = argv[++i];
  }
  return args;
}

// Tiny deterministic PRNG (mulberry32). Seed from 32-bit hash of input.
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const rng = mulberry32(seed);
  return {
    next: rng,
    int: (min, max) => Math.floor(rng() * (max - min + 1)) + min,
  };
}

function randomFillerDims(rng) {
  const w = rng.int(25, 350);
  const h = rng.int(25, 300);
  const r = rng.next();
  const d = r < 0.05 ? rng.int(400, 800) : r < 0.20 ? rng.int(200, 500) : rng.int(20, 300);
  return { width: w, height: h, depth: d };
}

function randomFillerDepth(rng) {
  const r = rng.next();
  return r < 0.05 ? rng.int(400, 800) : r < 0.20 ? rng.int(200, 500) : rng.int(20, 280);
}

function fireZone(absoluteHeightM) {
  if (absoluteHeightM < 3) return 1;
  if (absoluteHeightM < 6) return 2;
  return 3;
}

function slotType(w, h) {
  const area = w * h;
  if (area > 60000) return 'A';
  if (area > 15000) return 'B';
  return 'C';
}

function loadStories() {
  const configPath = resolve(__dirname, '../data/models/building_config.json');
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.balcony_levels?.length) {
      process.stderr.write(`Reading balcony levels from building_config.json\n`);
      return config.balcony_levels.map(l => ({
        name: l.name,
        label: l.label,
        baseY: l.ifc_railing_y_mm,
        railingHeight: l.railing_height_mm || 1000,
      }));
    }
  } catch (_) {
    process.stderr.write(`No building_config.json found, using default floor heights\n`);
  }
  return [
    { name: 'level-1', label: 'Ground floor',  baseY: 0, railingHeight: 1000 },
    { name: 'level-2', label: 'First floor',   baseY: 3500, railingHeight: 1000 },
    { name: 'level-3', label: 'Second floor',  baseY: 7000, railingHeight: 1000 },
  ];
}

function loadElements() {
  const path = resolve(__dirname, '../data/elements.json');
  if (!existsSync(path)) {
    process.stderr.write(`No elements.json — pure speculative wall\n`);
    return { raw: '', elements: [] };
  }
  const raw = readFileSync(path, 'utf-8');
  try {
    const db = JSON.parse(raw);
    return { raw, elements: db.elements || [] };
  } catch (e) {
    process.stderr.write(`Failed to parse elements.json: ${e.message}\n`);
    return { raw: '', elements: [] };
  }
}

function eligibleElements(elements, statusFloor) {
  const floorIdx = STATUS_ORDER.indexOf(statusFloor);
  if (floorIdx === -1) {
    process.stderr.write(`Unknown --status-floor ${statusFloor}, defaulting to ASSESSED\n`);
    return eligibleElements(elements, 'ASSESSED');
  }
  const out = [];
  for (const el of elements) {
    if (el.status === 'REJECTED') continue;
    const idx = STATUS_ORDER.indexOf(el.status);
    if (idx === -1 || idx < floorIdx) continue;
    const dim = el.dimensions_actual || el.dimensions_estimated;
    if (!dim?.width || !dim?.height) continue;
    out.push(el);
  }
  // Pack largest-first so headline objects aren't squeezed out.
  out.sort((a, b) => {
    const ad = a.dimensions_actual || a.dimensions_estimated;
    const bd = b.dimensions_actual || b.dimensions_estimated;
    return (bd.width * bd.height) - (ad.width * ad.height);
  });
  return out;
}

function makeBitmap(W, H, RES) {
  const gridW = Math.ceil(W / RES);
  const gridH = Math.ceil(H / RES);
  const grid = new Uint8Array(gridW * gridH);
  return { grid, gridW, gridH };
}

function canPlace(bmp, gx, gy, gw, gh) {
  const { grid, gridW, gridH } = bmp;
  if (gx < 0 || gy < 0 || gx + gw > gridW || gy + gh > gridH) return false;
  for (let y = gy; y < gy + gh; y++) {
    for (let x = gx; x < gx + gw; x++) {
      if (grid[y * gridW + x]) return false;
    }
  }
  return true;
}

function markOccupied(bmp, gx, gy, gw, gh) {
  const { grid, gridW } = bmp;
  for (let y = gy; y < gy + gh; y++) {
    for (let x = gx; x < gx + gw; x++) {
      grid[y * gridW + x] = 1;
    }
  }
}

function elementNum(id) {
  const m = String(id).match(/EL-?(\d+)/);
  return m ? m[1].padStart(4, '0') : null;
}

function buildCommittedSlot(el, story, storyIndex, gx, gy, gw, gh, RES) {
  const dim = el.dimensions_actual || el.dimensions_estimated;
  const xMM = gx * RES;
  const yLocal = gy * RES;
  const absoluteY = story.baseY + yLocal;
  const n = elementNum(el.id);
  const id = `SLOT-L${storyIndex + 1}-EL${n}`;
  return {
    id,
    face: story.name,
    type: slotType(dim.width, dim.height),
    position: { x: xMM, y: absoluteY, z: 0 },
    dimensions: {
      width: gw * RES,
      height: gh * RES,
      depth: dim.depth || 50,
    },
    height_m: parseFloat((absoluteY / 1000).toFixed(3)),
    fire_zone: fireZone(absoluteY / 1000),
    status: 'assigned',
    element_id: el.id,
    adjacent: [],
  };
}

function buildFillerSlot(story, storyIndex, gx, gy, gw, gh, depth, RES, fillerNum) {
  const xMM = gx * RES;
  const yLocal = gy * RES;
  const absoluteY = story.baseY + yLocal;
  const id = `SLOT-L${storyIndex + 1}-F${String(fillerNum).padStart(3, '0')}`;
  return {
    id,
    face: story.name,
    type: slotType(gw * RES, gh * RES),
    position: { x: xMM, y: absoluteY, z: 0 },
    dimensions: {
      width: gw * RES,
      height: gh * RES,
      depth,
    },
    height_m: parseFloat((absoluteY / 1000).toFixed(3)),
    fire_zone: fireZone(absoluteY / 1000),
    status: 'empty',
    element_id: null,
    adjacent: [],
  };
}

const WALL_W = 20000;
const RES = 5;
const COMMITTED_ATTEMPTS_PER_ELEMENT = 400;
const FILLER_PHASE1_ATTEMPTS = 8000;
const FILLER_INFILL_CAP_MM = 200;

function parsePriorStory(slotId, numStories) {
  const m = String(slotId || '').match(/SLOT-L(\d+)/);
  if (!m) return null;
  const s = parseInt(m[1], 10) - 1;
  return s >= 0 && s < numStories ? s : null;
}

function storyOrderFor(el, eligibleIndex, stories) {
  const order = [];
  const prior = parsePriorStory(el.slot_id, stories.length);
  if (prior !== null) order.push(prior);
  const start = eligibleIndex % stories.length;
  for (let k = 0; k < stories.length; k++) {
    const s = (start + k) % stories.length;
    if (!order.includes(s)) order.push(s);
  }
  return order;
}

function packAll(stories, eligible, rng) {
  const bitmaps = stories.map(s => makeBitmap(WALL_W, s.railingHeight || 1000, RES));
  const slotsByStory = stories.map(() => []);

  // --- Committed pass ---------------------------------------------------
  let committedCount = 0;
  let skipped = 0;
  for (let i = 0; i < eligible.length; i++) {
    const el = eligible[i];
    const dim = el.dimensions_actual || el.dimensions_estimated;
    const gw = Math.max(1, Math.round(dim.width / RES));
    const gh = Math.max(1, Math.round(dim.height / RES));

    let placed = false;
    const order = storyOrderFor(el, i, stories);
    for (const s of order) {
      if (placed) break;
      const bmp = bitmaps[s];
      for (let attempt = 0; attempt < COMMITTED_ATTEMPTS_PER_ELEMENT; attempt++) {
        const gx = rng.int(0, bmp.gridW - gw);
        const gy = rng.int(0, bmp.gridH - gh);
        if (!canPlace(bmp, gx, gy, gw, gh)) continue;
        markOccupied(bmp, gx, gy, gw, gh);
        const slot = buildCommittedSlot(el, stories[s], s, gx, gy, gw, gh, RES);
        slotsByStory[s].push(slot);
        placed = true;
        committedCount++;
        break;
      }
    }
    if (!placed) {
      process.stderr.write(`  ! Could not place ${el.id} (${dim.width}×${dim.height}mm) — wall full\n`);
      skipped++;
    }
  }
  process.stderr.write(`Committed: ${committedCount} placed, ${skipped} skipped\n`);

  // --- Filler pass — random shards --------------------------------------
  for (let s = 0; s < stories.length; s++) {
    const bmp = bitmaps[s];
    const story = stories[s];
    let fillerNum = 1;

    for (let attempt = 0; attempt < FILLER_PHASE1_ATTEMPTS; attempt++) {
      const dims = randomFillerDims(rng);
      const gw = Math.max(1, Math.round(dims.width / RES));
      const gh = Math.max(1, Math.round(dims.height / RES));
      const gx = rng.int(0, bmp.gridW - gw);
      const gy = rng.int(0, bmp.gridH - gh);
      if (!canPlace(bmp, gx, gy, gw, gh)) continue;
      markOccupied(bmp, gx, gy, gw, gh);
      slotsByStory[s].push(buildFillerSlot(story, s, gx, gy, gw, gh, dims.depth, RES, fillerNum++));
    }

    // Phase 2 — gap infill
    const { grid, gridW, gridH } = bmp;
    const capG = Math.ceil(FILLER_INFILL_CAP_MM / RES);
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (grid[gy * gridW + gx]) continue;

        let gw = 0;
        while (gx + gw < gridW && !grid[gy * gridW + gx + gw]) gw++;
        gw = Math.min(gw, capG);

        let gh = 0;
        let canExpand = true;
        while (gy + gh < gridH && canExpand) {
          for (let x = gx; x < gx + gw; x++) {
            if (grid[(gy + gh) * gridW + x]) { canExpand = false; break; }
          }
          if (canExpand) gh++;
        }
        gh = Math.min(gh, capG);

        if (gw < 2 || gh < 2) {
          markOccupied(bmp, gx, gy, Math.max(gw, 1), Math.max(gh, 1));
          continue;
        }

        markOccupied(bmp, gx, gy, gw, gh);
        slotsByStory[s].push(
          buildFillerSlot(story, s, gx, gy, gw, gh, randomFillerDepth(rng), RES, fillerNum++)
        );
      }
    }
  }

  return slotsByStory;
}

function computeAdjacency(slots) {
  const TOLERANCE = 12;
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    const ax1 = a.position.x, ax2 = ax1 + a.dimensions.width;
    const ay1 = a.position.y, ay2 = ay1 + a.dimensions.height;
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      if (b.face !== a.face) continue;
      const bx1 = b.position.x, bx2 = bx1 + b.dimensions.width;
      const by1 = b.position.y, by2 = by1 + b.dimensions.height;
      if (ax2 + TOLERANCE < bx1 || bx2 + TOLERANCE < ax1) continue;
      if (ay2 + TOLERANCE < by1 || by2 + TOLERANCE < ay1) continue;
      const hAdj = Math.abs(ax2 - bx1) < TOLERANCE || Math.abs(bx2 - ax1) < TOLERANCE;
      const yOverlap = ay1 < by2 && by1 < ay2;
      const vAdj = Math.abs(ay2 - by1) < TOLERANCE || Math.abs(by2 - ay1) < TOLERANCE;
      const xOverlap = ax1 < bx2 && bx1 < ax2;
      if ((hAdj && yOverlap) || (vAdj && xOverlap)) {
        a.adjacent.push(b.id);
        b.adjacent.push(a.id);
      }
    }
  }
}

// ----------------------------------------------------------------------
const args = parseArgs(process.argv);
const stories = loadStories();
const { raw: elementsRaw, elements } = loadElements();
const eligible = eligibleElements(elements, args.statusFloor);
process.stderr.write(`Eligible elements (floor=${args.statusFloor}): ${eligible.length} / ${elements.length}\n`);

const seed = hashString(elementsRaw + '|' + args.statusFloor);
const rng = makeRng(seed);
process.stderr.write(`PRNG seed: 0x${seed.toString(16)}\n`);

const slotsByStory = packAll(stories, eligible, rng);
const allSlots = slotsByStory.flat();
computeAdjacency(allSlots);

console.log(JSON.stringify({ slots: allSlots }, null, 2));

for (let s = 0; s < stories.length; s++) {
  const slots = slotsByStory[s];
  const depths = slots.map(x => x.dimensions.depth);
  const widths = slots.map(x => x.dimensions.width);
  const heights = slots.map(x => x.dimensions.height);
  const committed = slots.filter(x => x.element_id).length;
  process.stderr.write(
    `${stories[s].name}: ${slots.length} slots (${committed} committed), ` +
    `w ${Math.min(...widths)}–${Math.max(...widths)}mm, ` +
    `h ${Math.min(...heights)}–${Math.max(...heights)}mm, ` +
    `d ${Math.min(...depths)}–${Math.max(...depths)}mm\n`
  );
}
process.stderr.write(`Total: ${allSlots.length} slots\n`);
